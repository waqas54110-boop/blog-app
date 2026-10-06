// People's Court (V34): /court, /court/:id, wakeel banna, jury vote, admin controls, share card.
const express = require('express');
const pool = require('../db');
const config = require('../config');
const card = require('../lib/card');
const spam = require('../lib/spam');
const C = require('../lib/court');
const { renderCourtCard } = require('../lib/courtcard');

const router = express.Router();

const requireAdmin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    return res.status(403).render('404', { code: 403, title: 'Not allowed', message: 'Only the blog owner can do this.' });
  }
  next();
};
const toId = (v) => (/^\d{1,9}$/.test(String(v)) ? parseInt(v, 10) : null);
const oneLine = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const multiLine = (v, max) => String(v || '').replace(/\r/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const baseUrl = (req) => config.siteUrl || `${req.protocol}://${req.get('host')}`;
const SPAM_MSG = 'Your text was stopped by the spam filter (links, ads or repeated text). Please rewrite it and try again.';

// ---------- LIST ----------
router.get('/court', async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT c.*,
              (SELECT COUNT(*)::int FROM court_votes v WHERE v.case_id = c.id) AS total,
              (SELECT json_agg(json_build_object('side', l.side, 'username', u.username, 'tagline', l.tagline))
                 FROM court_lawyers l JOIN users u ON u.id = l.user_id WHERE l.case_id = c.id) AS lawyers
         FROM court_cases c WHERE NOT c.is_hidden ORDER BY c.created_at DESC LIMIT 80`
    );
    const cases = r.rows.map((c) => {
      const L = { a: null, b: null };
      (c.lawyers || []).forEach((l) => { L[l.side] = l; });
      return { ...c, lawyers: L, phase: C.phaseOf(c) };
    });
    const soon = (c) => (c.jury_ends_at ? new Date(c.jury_ends_at).getTime() : Infinity);
    const jury = cases.filter((c) => c.phase === 'jury').sort((x, y) => soon(x) - soon(y));
    const recruiting = cases.filter((c) => c.phase === 'recruiting');
    const decided = cases.filter((c) => c.phase === 'closed' || c.phase === 'expired');
    let top = [];
    try {
      top = (await pool.query(
        `SELECT u.username, COUNT(*) FILTER (WHERE c.verdict = l.side::text)::int AS wins, COUNT(*)::int AS cases
           FROM court_lawyers l JOIN court_cases c ON c.id = l.case_id JOIN users u ON u.id = l.user_id
          WHERE c.verdict IN ('a', 'b', 'tie') AND NOT c.is_hidden
          GROUP BY u.username ORDER BY wins DESC, cases DESC, u.username LIMIT 5`
      )).rows;
    } catch (e) { console.error('[court top lawyers]', e.message); }
    res.render('court', {
      title: "People's Court - Argue a case, judge the verdict",
      metaDescription: 'Two lawyers argue a trending issue, the public sits as jury and votes, and the verdict comes after 24 hours. Hear both sides before you decide.',
      jury, recruiting, decided, top,
      ogImage: card.isAvailable() ? baseUrl(req) + '/og/court.png' : null,
      ogImageCard: card.isAvailable(),
      msg: req.query.msg ? String(req.query.msg).slice(0, 200) : null,
    });
  } catch (err) { next(err); }
});

router.get('/og/court.png', async (req, res) => {
  if (!card.isAvailable()) return res.status(404).end();
  try {
    const png = await card.renderCard({ title: "People's Court: two lawyers, one public jury", category: 'Court', siteName: config.siteName, meta: 'Hear both sides, then vote' });
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('image/png').send(png);
  } catch (err) { console.error('[court og]', err.message); res.status(404).end(); }
});

// ---------- ADMIN: naya case (/court/:id se pehle) ----------
router.get('/court/new', requireAdmin, (req, res) => {
  res.render('court-new', { title: 'New Court Case', error: req.query.error || null });
});

router.post('/court', requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const back = (m) => res.redirect('/court/new?error=' + encodeURIComponent(m));
    const title = oneLine(b.title, 160);
    const summary = multiLine(b.summary, 1200);
    const sideA = oneLine(b.side_a, 60);
    const sideB = oneLine(b.side_b, 60);
    const recruitHours = parseInt(b.recruit_hours, 10);
    const juryHours = parseInt(b.jury_hours, 10);
    if (title.length < 8) return back('Please write the question as a title (at least 8 letters).');
    if (summary.length < 40) return back('Please write a short neutral background (at least 40 letters).');
    if (!sideA || !sideB) return back('Both sides need a name.');
    if (sideA.toLowerCase() === sideB.toLowerCase()) return back('The two sides must be different.');
    if (!Number.isInteger(recruitHours) || recruitHours < 1 || recruitHours > 336) return back('Lawyer sign-up time must be between 1 and 336 hours.');
    if (!Number.isInteger(juryHours) || juryHours < 1 || juryHours > 168) return back('Jury time must be between 1 and 168 hours.');
    const r = await pool.query(
      `INSERT INTO court_cases (title, summary, side_a, side_b, recruit_until, jury_hours, created_by)
       VALUES ($1, $2, $3, $4, now() + ($5::int * interval '1 hour'), $6, $7) RETURNING id`,
      [title, summary, sideA, sideB, recruitHours, juryHours, req.session.user.id]
    );
    res.redirect('/court/' + r.rows[0].id);
  } catch (err) { next(err); }
});

// ---------- SHARE CARD ----------
router.get(/^\/og\/court\/(\d{1,9})\.png$/, async (req, res) => {
  if (!card.isAvailable()) return res.status(404).end();
  try {
    const st = await C.loadCase(parseInt(req.params[0], 10), null, false);
    if (!st) return res.status(404).end();
    const png = await renderCourtCard(st, config.siteName);
    res.set('Cache-Control', 'public, max-age=300');
    res.type('image/png').send(png);
  } catch (err) { console.error('[court card]', err.message); res.status(404).end(); }
});

// ---------- DETAIL ----------
async function applyPendingVote(req, id) {
  const p = req.session.pendingCourtVote;
  if (!p || p.id !== id || !req.session.user) return null;
  delete req.session.pendingCourtVote;
  const err = await C.castVote({ caseId: id, userId: req.session.user.id, side: p.side, via: p.via });
  return err || 'Your vote has been counted.';
}

router.get('/court/:id', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return next();
    const uid = req.session.user ? req.session.user.id : null;

    // Lawyer ke link se aaye (?via=a|b): yaad rakho, vote ke saath save hoga
    const via = C.toSide(String(req.query.via || ''));
    if (via) {
      req.session.courtVia = req.session.courtVia || {};
      if (req.session.courtVia[id] !== via) req.session.courtVia[id] = via;
    }

    let notice = await applyPendingVote(req, id);
    const st = await C.loadCase(id, uid, res.locals.isAdmin);
    if (!st) return next();
    if (!notice && req.query.argued) notice = 'Your arguments are in.' + (st.phase === 'jury' ? ' The jury is now voting!' : ' Waiting for the other lawyer.');
    if (!notice && req.query.error) notice = String(req.query.error).slice(0, 200);
    if (!notice && req.query.voted) notice = 'Your vote has been counted.';
    if (!notice && req.query.closing) notice = 'Your closing statement is posted.';

    const base = baseUrl(req);
    const url = `${base}/court/${id}`;
    const utm = (src, extra = '') => `${url}?${extra}utm_source=${src}&utm_medium=share`;
    const mySide = st.myLawyerSide;
    const myCamp = mySide ? `via=${mySide}&` : '';
    const waText = mySide
      ? `I am the lawyer for "${st.label[mySide]}" in the People's Court on ${config.siteName}.\n${st.c.title}\n\nRead both sides and join the jury 👉 ${utm('whatsapp', myCamp)}`
      : `⚖️ People's Court: ${st.c.title}\n${st.label.a} vs ${st.label.b}\n\nRead both lawyers and cast your vote 👉 ${utm('whatsapp')}`;
    const lawyerNames = ['a', 'b'].filter((s) => st.lawyers[s]).map((s) => st.lawyers[s].username);
    const desc = st.phase === 'closed'
      ? `The jury has decided: ${C.verdictText(st.c, st.verdict)} Read both arguments.`
      : `${st.label.a} vs ${st.label.b}. ${lawyerNames.length === 2 ? `${lawyerNames[0]} and ${lawyerNames[1]} argue; you are the jury.` : 'Lawyers wanted: pick a side and argue it.'}`;
    res.render('court-case', {
      st, notice,
      title: `${st.c.title} | People's Court`,
      metaDescription: desc.slice(0, 200),
      ogImage: card.isAvailable() ? `${base}/og/court/${id}.png` : null,
      ogImageCard: card.isAvailable(),
      shareUrls: { whatsapp: utm('whatsapp', myCamp), facebook: utm('facebook', myCamp), x: utm('x', myCamp), copy: utm('link', myCamp) },
      waText, mySide,
      verdictText: st.phase === 'closed' ? C.verdictText(st.c, st.verdict) : null,
      errors: null,
    });
  } catch (err) { next(err); }
});

// ---------- WAKEEL BANNA ----------
router.post('/court/:id/argue', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.redirect('/court');
    if (!req.session.user) { req.session.returnTo = '/court/' + id; return res.redirect('/login'); }
    const side = C.toSide(String(req.body.side || ''));
    const opening = multiLine(req.body.opening, 1500);
    const tagline = oneLine(req.body.tagline, 140);
    const back = (m) => res.redirect(`/court/${id}?error=${encodeURIComponent(m)}#lawyer`);
    if (!side) return back('Please choose a side.');
    if (opening.length < 120) return back('Your opening argument should be at least 120 characters, so the jury has something to weigh.');
    if (tagline.length < 10) return back('Add a one-line punchline (at least 10 characters).');
    const v = await spam.check(opening + '\n' + tagline, { userId: req.session.user.id, isAdmin: req.session.user.role === 'admin' });
    if (v.action !== 'ok') return back(SPAM_MSG);
    const r = await C.argue({ caseId: id, userId: req.session.user.id, side, opening, tagline });
    if (r.error) return back(r.error);
    res.redirect(`/court/${id}?argued=1`);
  } catch (err) { next(err); }
});

// ---------- JURY VOTE ----------
router.post('/court/:id/vote', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.redirect('/court');
    const side = C.toSide(String(req.body.side || ''));
    const via = (req.session.courtVia && req.session.courtVia[id]) || null;
    if (!side) return res.redirect('/court/' + id);
    if (!req.session.user) {
      req.session.pendingCourtVote = { id, side, via };
      req.session.returnTo = '/court/' + id;
      return res.redirect('/login');
    }
    const err = await C.castVote({ caseId: id, userId: req.session.user.id, side, via });
    res.redirect(`/court/${id}` + (err ? '?error=' + encodeURIComponent(err) : '?voted=1') + '#verdict');
  } catch (err) { next(err); }
});

// ---------- WAKEEL KA CLOSING STATEMENT (jury ke dauran ek baar) ----------
router.post('/court/:id/closing', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.redirect('/court');
    if (!req.session.user) return res.redirect('/login');
    const text = multiLine(req.body.closing, 500);
    const back = (m) => res.redirect(`/court/${id}?error=${encodeURIComponent(m)}#lawyer`);
    if (text.length < 20) return back('Your closing statement should be at least 20 characters.');
    const v = await spam.check(text, { userId: req.session.user.id, isAdmin: req.session.user.role === 'admin' });
    if (v.action !== 'ok') return back(SPAM_MSG);
    const r = await pool.query(
      `UPDATE court_lawyers l SET closing = $3
         FROM court_cases c
        WHERE l.case_id = $1 AND l.user_id = $2 AND c.id = l.case_id AND l.closing IS NULL
          AND c.jury_ends_at IS NOT NULL AND c.jury_ends_at > now() AND NOT c.is_hidden
        RETURNING l.case_id`,
      [id, req.session.user.id, text]
    );
    if (!r.rows[0]) return back('You can post one closing statement while the jury is voting.');
    res.redirect(`/court/${id}?closing=1#arguments`);
  } catch (err) { next(err); }
});

router.post('/court/:id/share', (req, res) => {
  const id = toId(req.params.id);
  if (id) pool.query('UPDATE court_cases SET shares = shares + 1 WHERE id = $1', [id]).catch(() => {});
  res.status(204).end();
});

// ---------- ADMIN ----------
router.post('/court/:id/extend', requireAdmin, async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (id) {
      await pool.query(
        `UPDATE court_cases SET recruit_until = GREATEST(recruit_until, now()) + interval '24 hours' WHERE id = $1 AND jury_starts_at IS NULL`, [id]
      );
    }
    res.redirect('/court/' + id);
  } catch (err) { next(err); }
});

router.post('/court/:id/endjury', requireAdmin, async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (id) {
      await pool.query(`UPDATE court_cases SET jury_ends_at = now() WHERE id = $1 AND jury_ends_at > now()`, [id]);
      await C.finalizeDue();
    }
    res.redirect('/court/' + id);
  } catch (err) { next(err); }
});

router.post('/court/:id/hide', requireAdmin, async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (id) await pool.query('UPDATE court_cases SET is_hidden = NOT is_hidden WHERE id = $1', [id]);
    res.redirect('/court/' + id);
  } catch (err) { next(err); }
});

router.post('/court/:id/delete', requireAdmin, async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (id) await pool.query('DELETE FROM court_cases WHERE id = $1', [id]);
    res.redirect('/court?msg=' + encodeURIComponent('Case deleted.'));
  } catch (err) { next(err); }
});

module.exports = router;
