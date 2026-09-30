// Vote Contest: admin do options (naam + image) ka muqabla banata hai, readers vote dete hain, link WhatsApp/Facebook par share hota hai.
const express = require('express');
const pool = require('../db');
const config = require('../config');
const card = require('../lib/card');
const { renderVoteCard } = require('../lib/votecard');

const router = express.Router();
const IMG_RE = /^\/img\/\d{1,9}$/;

const requireAdmin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    return res.status(403).render('404', { code: 403, title: 'Not allowed', message: 'Only the blog owner can do this.' });
  }
  next();
};
const oneLine = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const isOpen = (p) => !p.is_closed && (!p.ends_at || new Date(p.ends_at).getTime() > Date.now());
const baseUrl = (req) => config.siteUrl || `${req.protocol}://${req.get('host')}`;

const COUNTS = `(SELECT COUNT(*)::int FROM poll_votes v WHERE v.poll_id = p.id AND v.pick = 'a') AS votes_a,
                (SELECT COUNT(*)::int FROM poll_votes v WHERE v.poll_id = p.id AND v.pick = 'b') AS votes_b`;

async function castVote(pollId, userId, pick) {
  const r = await pool.query('SELECT is_closed, ends_at FROM polls WHERE id = $1', [pollId]);
  if (!r.rows[0]) return 'Contest not found.';
  if (!isOpen(r.rows[0])) return 'Voting for this contest is closed.';
  await pool.query(
    `INSERT INTO poll_votes (poll_id, user_id, pick) VALUES ($1, $2, $3)
     ON CONFLICT (poll_id, user_id) DO UPDATE SET pick = EXCLUDED.pick`,
    [pollId, userId, pick]
  );
  return null;
}

// ---------- LIST ----------
router.get('/votes', async (req, res, next) => {
  try {
    const r = await pool.query(`SELECT p.*, ${COUNTS} FROM polls p ORDER BY p.created_at DESC LIMIT 60`);
    const polls = r.rows.map((p) => ({ ...p, open: isOpen(p) }));
    res.render('votes', {
      title: 'Vote Contests',
      metaDescription: 'Pick your side in fun head-to-head vote contests and share them with friends.',
      polls,
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
    const title = oneLine(b.title, 150);
    const aName = oneLine(b.a_name, 60);
    const bName = oneLine(b.b_name, 60);
    const aImg = String(b.a_image || '').trim();
    const bImg = String(b.b_image || '').trim();
    const back = (msg) => res.redirect('/votes/new?error=' + encodeURIComponent(msg));

    if (title.length < 3) return back('Please write a title (at least 3 letters).');
    if (!aName || !bName || aName.toLowerCase() === bName.toLowerCase()) return back('Enter two different names.');
    if (!IMG_RE.test(aImg) || !IMG_RE.test(bImg)) return back('Please upload both images.');

    let endsAt = null;
    if (b.ends_at) {
      const d = new Date(b.ends_at);
      if (isNaN(d.getTime())) return back('End time is not valid.');
      endsAt = d.toISOString();
    }

    const ids = [aImg, bImg].map((u) => parseInt(u.slice(5), 10));
    const ex = await pool.query('SELECT COUNT(DISTINCT id)::int AS c FROM images WHERE id = ANY($1)', [ids]);
    if (ex.rows[0].c !== new Set(ids).size) return back('One of the images was not found. Upload again.');

    const r = await pool.query(
      `INSERT INTO polls (title, a_name, a_image, b_name, b_image, ends_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [title, aName, aImg, bName, bImg, endsAt, req.session.user.id]
    );
    res.redirect('/votes/' + r.rows[0].id);
  } catch (err) { next(err); }
});

// ---------- SHARE CARD ----------
router.get(/^\/og\/vote\/(\d{1,9})\.png$/, async (req, res) => {
  if (!card.isAvailable()) return res.status(404).end();
  try {
    const r = await pool.query('SELECT * FROM polls p WHERE p.id = $1', [parseInt(req.params[0], 10)]);
    if (!r.rows[0]) return res.status(404).end();
    const png = await renderVoteCard(r.rows[0], config.siteName);
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('image/png').send(png);
  } catch (err) {
    console.error('[votecard]', err.message);
    res.status(404).end();
  }
});

// ---------- DETAIL (share hone wala page) ----------
router.get('/votes/:id', async (req, res, next) => {
  try {
    const id = /^\d{1,9}$/.test(req.params.id) ? parseInt(req.params.id, 10) : null;
    if (!id) return next();

    // Login se pehle jo option dabaya tha, login ke baad wo vote lagao
    let notice = null;
    const pending = req.session.pendingVote;
    if (req.session.user && pending && pending.id === id) {
      delete req.session.pendingVote;
      notice = (await castVote(id, req.session.user.id, pending.pick)) || 'Your vote is saved ✅';
    }

    const r = await pool.query(`SELECT p.*, ${COUNTS} FROM polls p WHERE p.id = $1`, [id]);
    const poll = r.rows[0];
    if (!poll) return next();

    let myPick = null;
    if (req.session.user) {
      const m = await pool.query('SELECT pick FROM poll_votes WHERE poll_id = $1 AND user_id = $2', [id, req.session.user.id]);
      myPick = m.rows[0] ? m.rows[0].pick : null;
    }

    const base = baseUrl(req);
    const url = `${base}/votes/${id}`;
    const total = poll.votes_a + poll.votes_b;
    const pctA = total ? Math.round((poll.votes_a * 100) / total) : 0;
    const cardOk = card.isAvailable();
    res.render('vote', {
      title: poll.title,
      metaDescription: `${poll.a_name} vs ${poll.b_name} - cast your vote now!`,
      ogImage: cardOk ? `${base}/og/vote/${id}.png` : base + poll.a_image,
      ogImageCard: cardOk,
      poll, open: isOpen(poll), myPick, total, pctA, pctB: total ? 100 - pctA : 0,
      url,
      pickPreview: isOpen(poll) && ['a', 'b'].includes(req.query.pick) && myPick !== req.query.pick ? req.query.pick : null,
      notice: notice || (req.query.error ? String(req.query.error).slice(0, 200) : null),
      waText: `🗳️ ${poll.title}\n${poll.a_name} vs ${poll.b_name}\n\nVote here 👉 ${url}\n\nDirect vote:\n▶ ${poll.a_name}: ${url}?pick=a\n▶ ${poll.b_name}: ${url}?pick=b`,
    });
  } catch (err) { next(err); }
});

// ---------- VOTE (guest bhi dabaye to login ke baad vote lag jata hai) ----------
router.post('/votes/:id/vote', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const pick = String(req.body.pick || '');
    if (!Number.isInteger(id) || !['a', 'b'].includes(pick)) return res.redirect('/votes');

    if (!req.session.user) {
      req.session.pendingVote = { id, pick };
      req.session.returnTo = '/votes/' + id;
      return res.redirect('/login');
    }
    const err = await castVote(id, req.session.user.id, pick);
    res.redirect('/votes/' + id + (err ? '?error=' + encodeURIComponent(err) : '?voted=1'));
  } catch (err) { next(err); }
});

// ---------- ADMIN: band/dobara kholna, delete ----------
router.post('/votes/:id/toggle', requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isInteger(id)) await pool.query('UPDATE polls SET is_closed = NOT is_closed WHERE id = $1', [id]);
    res.redirect('/votes/' + id);
  } catch (err) { next(err); }
});

router.post('/votes/:id/delete', requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isInteger(id)) await pool.query('DELETE FROM polls WHERE id = $1', [id]);
    res.redirect('/votes');
  } catch (err) { next(err); }
});

module.exports = router;
