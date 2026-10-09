// Vote Contest V9: 2-6 options ya knockout (4/8), live counting, "I voted" share-card,
// contest par comments, analytics events. Admin banata hai, readers vote dete hain.
const express = require('express');
const pool = require('../db');
const config = require('../config');
const card = require('../lib/card');
const { renderVoteCard, renderVotedCard } = require('../lib/votecard');
const P = require('../lib/polls');
const { notifyUser } = require('../lib/notify');
const S = require('../lib/sponsor');
const T = require('../lib/telegram');
const spam = require('../lib/spam');
const moderation = require('../lib/moderation');

const router = express.Router();
const IMG_RE = /^\/img\/\d{1,9}$/;
const SHARE_CHANNELS = ['whatsapp', 'facebook', 'copy', 'native', 'tiktok'];
const { detectSource } = require('../lib/analytics');

const requireLogin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  next();
};
const requireAdmin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    return res.status(403).render('404', { code: 403, title: 'Not allowed', message: 'Only the blog owner can do this.' });
  }
  next();
};
const oneLine = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const baseUrl = (req) => config.siteUrl || `${req.protocol}://${req.get('host')}`;
const toId = (v) => (/^\d{1,9}$/.test(String(v)) ? parseInt(v, 10) : null);
const uidOf = (req) => (req.session.user ? req.session.user.id : null);
// Vote ke baad kahan wapas jana hai (post ke andar widget se vote kiya ho to wahi post)
const safeRet = (v) => (/^\/(posts\/[a-z0-9-]{1,120}|votes\/\d{1,9})?$/.test(String(v || '')) ? String(v) : null);

// ---------- LIST ----------
router.get('/votes', async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT p.*,
              (SELECT COUNT(*)::int FROM poll_votes v WHERE v.poll_id = p.id)
              + (SELECT COUNT(*)::int FROM poll_match_votes v WHERE v.poll_id = p.id) AS total,
              (SELECT COUNT(*)::int FROM poll_comments c WHERE c.poll_id = p.id) AS comment_count,
              (SELECT json_agg(json_build_object('name', o.name, 'image', o.image) ORDER BY o.pos)
                 FROM poll_options o WHERE o.poll_id = p.id) AS opts
       FROM polls p ORDER BY p.created_at DESC LIMIT 60`
    );
    const polls = r.rows.map((p) => ({ ...p, open: P.isOpen(p), opts: p.opts || [] }));
    res.render('votes', {
      title: 'Vote Contests',
      metaDescription: 'Pick your side in fun head-to-head vote contests and knockouts, and share them with friends.',
      polls,
      tgMsg: req.query.tg ? String(req.query.tg).slice(0, 200) : null,
      tgOn: T.isConfigured(),
    });
  } catch (err) { next(err); }
});

// ---------- ADMIN: naya contest (/votes/:id se pehle hona zaroori) ----------
router.get('/votes/new', requireAdmin, (req, res) => {
  res.render('vote-new', { title: 'New Vote Contest', error: req.query.error || null });
});

router.post('/votes', requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const back = (msg) => res.redirect('/votes/new?error=' + encodeURIComponent(msg));
    const kind = b.kind === 'knockout' ? 'knockout' : 'vote';
    const title = oneLine(b.title, 150);
    if (title.length < 3) return back('Please write a title (at least 3 letters).');

    const names = [].concat(b.opt_name || []);
    const images = [].concat(b.opt_image || []);
    const options = names
      .map((n, i) => ({ name: oneLine(n, 60), image: String(images[i] || '').trim() }))
      .filter((o) => o.name || o.image);

    if (kind === 'knockout' && options.length !== 4 && options.length !== 8) return back('A knockout needs exactly 4 or 8 contenders.');
    if (kind === 'vote' && (options.length < 2 || options.length > 6)) return back('A vote contest needs 2 to 6 options.');
    if (options.some((o) => !o.name)) return back('Every option needs a name.');
    if (new Set(options.map((o) => o.name.toLowerCase())).size !== options.length) return back('Option names must all be different.');
    if (options.some((o) => !IMG_RE.test(o.image))) return back('Please upload an image for every option.');

    let endsAt = null;
    if (kind === 'vote' && b.ends_at) {
      const d = new Date(b.ends_at);
      if (isNaN(d.getTime())) return back('End time is not valid.');
      endsAt = d.toISOString();
    }
    let roundHours = null;
    if (kind === 'knockout' && String(b.round_hours || '').trim()) {
      roundHours = parseInt(b.round_hours, 10);
      if (!Number.isInteger(roundHours) || roundHours < 1 || roundHours > 720) return back('Round length must be between 1 and 720 hours.');
    }

    const sp = await S.parseSponsor(b);
    if (sp.error) return back(sp.error);

    const ids = [...new Set(options.map((o) => parseInt(o.image.slice(5), 10)))];
    const ex = await pool.query('SELECT COUNT(DISTINCT id)::int AS c FROM images WHERE id = ANY($1)', [ids]);
    if (ex.rows[0].c !== ids.length) return back('One of the images was not found. Upload again.');

    const id = await P.createPoll({ kind, title, options, endsAt, roundHours, userId: req.session.user.id });
    if (sp.value.name || sp.value.prize || sp.value.logo || sp.value.featured || sp.value.refBonus || sp.value.pool !== 'all') await S.saveSponsor(id, sp.value);
    res.redirect('/votes/' + id);
  } catch (err) { next(err); }
});

// ---------- SHARE CARDS ----------
async function optionsOf(id) {
  return (await pool.query('SELECT id, name, image FROM poll_options WHERE poll_id = $1 ORDER BY pos', [id])).rows;
}

router.get(/^\/og\/vote\/(\d{1,9})\.png$/, async (req, res) => {
  if (!card.isAvailable()) return res.status(404).end();
  try {
    const id = parseInt(req.params[0], 10);
    const r = await pool.query('SELECT id, title, kind FROM polls WHERE id = $1', [id]);
    if (!r.rows[0]) return res.status(404).end();
    const png = await renderVoteCard(r.rows[0], await optionsOf(id), config.siteName);
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('image/png').send(png);
  } catch (err) {
    console.error('[votecard]', err.message);
    res.status(404).end();
  }
});

// "I voted for X" card: ?v=<optionId>&m=<matchId, sirf knockout mein>
router.get(/^\/og\/vote\/(\d{1,9})\/voted\.png$/, async (req, res) => {
  if (!card.isAvailable()) return res.status(404).end();
  try {
    const id = parseInt(req.params[0], 10);
    const v = toId(req.query.v);
    const m = toId(req.query.m);
    const st = await P.loadState(id, null);
    if (!st || !v) return res.status(404).end();
    const match = st.kind === 'knockout' ? st.matches.find((x) => x.id === m) : st.matches[0];
    if (!match || !match.options.some((o) => o.id === v)) return res.status(404).end();
    const png = await renderVotedCard({ id, title: st.title }, match.options, v, match.label, config.siteName);
    res.set('Cache-Control', 'public, max-age=300');
    res.type('image/png').send(png);
  } catch (err) {
    console.error('[votecard voted]', err.message);
    res.status(404).end();
  }
});

// ---------- LIVE STATE (page refresh ke bagair percentage badalne ke liye) ----------
router.get('/votes/:id/state.json', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return next();
    const st = await P.loadState(id, uidOf(req), baseUrl(req));
    if (!st) return res.status(404).json({ error: 'not found' });
    res.set('Cache-Control', 'no-store');
    res.json(st);
  } catch (err) { next(err); }
});

// ---------- TIKTOK ----------
// Chhota link (TikTok bio mein lagane ke liye): /t/5 -> contest page, source = tiktok
router.get('/t/:id', (req, res, next) => {
  const id = toId(req.params.id);
  if (!id) return next();
  const camp = oneLine(req.query.c, 40).toLowerCase().replace(/[^a-z0-9_\-]/g, '');
  res.redirect(302, `/votes/${id}?utm_source=tiktok&utm_medium=bio` + (camp ? '&utm_campaign=' + camp : ''));
});

// TikTok Video Studio: browser mein hi 9:16 vote video banta hai (server par ffmpeg nahi chahiye)
router.get('/votes/:id/tiktok', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return next();
    const base = baseUrl(req);
    const st = await P.loadState(id, uidOf(req), base);
    if (!st) return next();
    const opts = st.matches[0].options.map((o) => ({ name: o.name, image: o.image, pct: o.pct }));
    const shortUrl = `${base}/t/${id}`;
    const names = opts.map((o) => o.name);
    const caption = `${st.title}\n\n${names.join(' vs ')}: who wins? \u{1F525} Vote now, link in bio \u{1F446}`;
    const tags = `#vote #poll #fyp #foryou #viral #${String(config.siteName || 'vote').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    res.render('vote-tiktok', {
      title: 'TikTok video: ' + st.title,
      metaDescription: 'Make a TikTok vote video for this contest.',
      st,
      shortUrl,
      caption,
      tags,
      studio: { id, title: st.title, options: opts, shortUrl, siteName: config.siteName || '', open: st.open },
    });
  } catch (err) { next(err); }
});

// ---------- DETAIL (share hone wala page) ----------
router.get('/votes/:id', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return next();

    const notice = await P.applyPending(req, id);
    const base = baseUrl(req);
    const st = await P.loadState(id, uidOf(req), base);
    if (!st) return next();

    const ex = await S.extras(id);
    const adminX = res.locals.isAdmin ? await S.adminInfo(id, st, ex) : null;

    if (!req.query.voted) P.trackView(req, res, id, 'page'); // vote ke baad wala redirect dobara "view" nahi gina jata

    const flat = st.matches.flatMap((m) => m.options);
    const names = st.matches[0].options.map((o) => o.name);
    const cardOk = card.isAvailable();

    // Share link mein ?v= ho to preview mein "I voted for X" card dikhao
    let ogImage = cardOk ? `${base}/og/vote/${id}.png` : base + flat[0].image;
    const v = toId(req.query.v);
    const m = toId(req.query.m);
    if (cardOk && v) {
      const match = st.kind === 'knockout' ? st.matches.find((x) => x.id === m) : st.matches[0];
      if (match && match.options.some((o) => o.id === v)) {
        ogImage = `${base}/og/vote/${id}/voted.png?v=${v}` + (st.kind === 'knockout' ? `&m=${match.id}` : '');
      }
    }

    // ?pick=<optionId> (ya purana a/b) wala direct-vote link: sirf "confirm" dikhata hai
    let pickPreview = null;
    if (st.kind === 'vote' && st.open && req.query.pick) {
      const opts = st.matches[0].options;
      const q = String(req.query.pick);
      const o = /^\d+$/.test(q) ? opts.find((x) => x.id === parseInt(q, 10)) : q === 'a' ? opts[0] : q === 'b' ? opts[1] : null;
      if (o && st.matches[0].myPick !== o.id) pickPreview = o;
    }

    const utm = (src) => `${st.url}${st.url.includes('?') ? '&' : '?'}utm_source=${src}&utm_medium=share`;
    let waText = `🗳️ ${st.title}\n${names.join(' vs ')}\n\nVote here 👉 ${utm('whatsapp')}`;
    if (st.kind === 'vote') {
      waText += '\n\nDirect vote:\n' + st.matches[0].options.map((o) => `▶ ${o.name}: ${st.url}?pick=${o.id}&utm_source=whatsapp&utm_medium=share`).join('\n');
    }

    // Comments (replies ke sath)
    const cr = await pool.query(
      `SELECT c.id, c.body, c.created_at, c.user_id, c.parent_id, c.is_hidden, u.username
       FROM poll_comments c JOIN users u ON u.id = c.user_id
       WHERE c.poll_id = $1 ORDER BY c.created_at ASC`, [id]
    );
    const byParent = {};
    const top = [];
    cr.rows.forEach((c) => { if (c.parent_id) (byParent[c.parent_id] = byParent[c.parent_id] || []).push(c); else top.push(c); });
    const threads = top.map((c) => ({ ...c, replies: byParent[c.id] || [] }));

    const fromTikTok = detectSource(req).source === 'tiktok' || P.voteSource(req, id) === 'tiktok';

    res.render('vote', {
      fromTikTok,
      ex, adminX,
      title: st.title,
      metaDescription: st.kind === 'knockout'
        ? `Knockout: ${names.join(', ')} - vote every round and pick the champion!`
        : `${names.join(' vs ')} - cast your vote now!`,
      ogImage,
      ogImageCard: cardOk,
      st,
      pickPreview,
      notice: notice || (req.query.error ? String(req.query.error).slice(0, 200) : null),
      shareUrls: { whatsapp: utm('whatsapp'), facebook: utm('facebook'), copy: utm('link') },
      waText,
      threads,
      commentCount: cr.rows.length,
      commentError: req.query.commentError || null,
    });
  } catch (err) { next(err); }
});

// ---------- VOTE (guest bhi dabaye to login ke baad vote lag jata hai) ----------
router.post('/votes/:id/vote', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    const wantsJson = /json/.test(req.get('accept') || '');
    if (!id) return wantsJson ? res.status(404).json({ error: 'not found' }) : res.redirect('/votes');

    let optionId = toId(req.body.option);
    if (!optionId && ['a', 'b'].includes(req.body.pick)) { // purane a/b buttons
      const o = (await optionsOf(id))[req.body.pick === 'a' ? 0 : 1];
      optionId = o ? o.id : null;
    }
    const matchId = toId(req.body.match); // knockout mein match id, warna null/0
    const ret = safeRet(req.body.ret);

    if (!req.session.user) {
      req.session.pendingVote = { id, option: optionId, match: matchId };
      req.session.returnTo = ret || '/votes/' + id;
      return wantsJson ? res.status(401).json({ login: '/login' }) : res.redirect('/login');
    }

    const err = await P.castVote({
      pollId: id, userId: req.session.user.id, optionId, matchId, source: P.voteSource(req, id),
    });

    if (wantsJson) {
      const st = await P.loadState(id, req.session.user.id, baseUrl(req));
      if (err) return res.status(400).json({ error: err, state: st });
      res.set('Cache-Control', 'no-store');
      return res.json({ ok: true, state: st, voted: { optionId, matchId: matchId || 0 } });
    }
    if (ret) return res.redirect(ret + '#poll-' + id);
    res.redirect('/votes/' + id + (err ? '?error=' + encodeURIComponent(err) : '?voted=1'));
  } catch (err) { next(err); }
});

// Share button dabane ki ginti (navigator.sendBeacon se aata hai)
router.post('/votes/:id/share', (req, res) => {
  const id = toId(req.params.id);
  const ch = String(req.body.ch || '');
  if (id && SHARE_CHANNELS.includes(ch)) P.trackShare(req, id, ch);
  res.status(204).end();
});

// ---------- ADMIN: band/dobara kholna, agla round, delete ----------
router.post('/votes/:id/toggle', requireAdmin, async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (id) await pool.query('UPDATE polls SET is_closed = NOT is_closed WHERE id = $1', [id]);
    res.redirect('/votes/' + id);
  } catch (err) { next(err); }
});

router.post('/votes/:id/advance', requireAdmin, async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (id) await P.advanceRound(id, true);
    res.redirect('/votes/' + id);
  } catch (err) { next(err); }
});

router.post('/votes/:id/delete', requireAdmin, async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (id) await pool.query('DELETE FROM polls WHERE id = $1', [id]);
    res.redirect('/votes');
  } catch (err) { next(err); }
});

// ---------- COMMENTS ----------
router.post('/votes/:id/comments', requireLogin, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.redirect('/votes');
  const body = String(req.body.body || '').trim();
  if (!body || body.length > 1000) {
    return res.redirect(`/votes/${id}?commentError=${encodeURIComponent('Comment must be between 1 and 1000 characters.')}#comments`);
  }
  const me = req.session.user;
  try {
    const pr = await pool.query('SELECT id, title, created_by FROM polls WHERE id = $1', [id]);
    const poll = pr.rows[0];
    if (!poll) return res.redirect('/votes');

    // Sirf 1 level nesting: reply ka reply bhi top-level comment ke neeche lagta hai
    let parentId = null;
    let repliedTo = null;
    const replyToId = toId(req.body.parent_id);
    if (replyToId) {
      const r = await pool.query('SELECT id, user_id, parent_id FROM poll_comments WHERE id = $1 AND poll_id = $2', [replyToId, id]);
      repliedTo = r.rows[0] || null;
      if (repliedTo) parentId = repliedTo.parent_id || repliedTo.id;
    }
    // Spam filter: block = save nahi hota, hold = hidden save + moderation queue
    const verdict = await spam.check(body, { userId: me.id, isAdmin: me.role === 'admin' });
    if (verdict.action === 'block') {
      return res.redirect(`/votes/${id}?commentError=${encodeURIComponent(verdict.message)}#comments`);
    }
    const held = verdict.action === 'hold';

    const ins = await pool.query(
      'INSERT INTO poll_comments (poll_id, user_id, body, parent_id, is_hidden) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [id, me.id, body, parentId, held]
    );
    const link = `/votes/${id}#c${ins.rows[0].id}`;
    const short = poll.title.length > 60 ? poll.title.slice(0, 57) + '...' : poll.title;

    if (held) {
      await moderation.holdForReview('poll_comment', ins.rows[0].id, verdict.reason);
      return res.redirect(`/votes/${id}?commentNotice=${encodeURIComponent('Your comment is waiting for review by the site owner. Only you can see it until then.')}#c${ins.rows[0].id}`);
    }

    if (repliedTo && repliedTo.user_id !== me.id) {
      notifyUser(repliedTo.user_id, `${me.username} replied to your comment on the contest "${short}"`, link, {
        email: true, emailSubject: `${me.username} replied to your comment`,
      });
    }
    if (poll.created_by && poll.created_by !== me.id && (!repliedTo || repliedTo.user_id !== poll.created_by)) {
      notifyUser(poll.created_by, `${me.username} commented on the contest "${short}"`, link);
    }
    res.redirect(link);
  } catch (err) {
    console.error(err);
    res.redirect('/votes/' + id);
  }
});

router.post('/vote-comments/:id/delete', requireLogin, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.redirect('/votes');
  try {
    const r = await pool.query(
      `DELETE FROM poll_comments WHERE id = $1 AND ($3 = 'admin' OR user_id = $2) RETURNING poll_id`,
      [id, req.session.user.id, req.session.user.role]
    );
    res.redirect(r.rows[0] ? `/votes/${r.rows[0].poll_id}#comments` : '/votes');
  } catch (err) {
    console.error(err);
    res.redirect('/votes');
  }
});

module.exports = router;
