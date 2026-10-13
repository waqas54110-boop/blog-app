// Ludo (V60): /ludo - online multiplayer rooms (2-4 players, bots can fill seats), lobby, leaderboard.
// The browser polls /ludo/:code/state.json (mounted in app.js before the heavy page middleware) and POSTs JSON actions to /ludo/:code/act.
const express = require('express');
const L = require('../lib/ludo');

const router = express.Router();
const oneLine = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanCode = (v) => { const c = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return /^[A-Z2-9]{5}$/.test(c) ? c : null; };
const needLogin = (req, res) => { req.session.returnTo = req.originalUrl; res.redirect('/login'); };
const back = (res, path, kind, text) => res.redirect(`${path}?${kind}=${encodeURIComponent(text)}`);

const notSetUp = (res, json) => (json
  ? res.status(503).json({ error: 'Ludo is not set up yet (run migration_v60.sql).' })
  : res.status(503).render('404', { code: 503, title: 'Ludo not set up', message: 'The site owner needs to run migration_v60.sql first.' }));
const wrapPage = (fn) => (req, res, next) => fn(req, res, next).catch((err) => (err && err.code === '42P01' ? notSetUp(res, false) : next(err)));
const wrapJson = (fn) => (req, res) => fn(req, res).catch((err) => {
  if (err && err.code === '42P01') return notSetUp(res, true);
  console.error('[ludo]', err.message);
  if (!res.headersSent) res.status(500).json({ error: 'Server error, please try again.' });
});

// Lobby
router.get('/ludo', wrapPage(async (req, res) => {
  const u = req.session.user;
  const data = await L.lobby(u ? u.id : null);
  res.render('ludo', {
    title: 'Ludo - play online with friends | Khabzo',
    metaDescription: 'Play Ludo online with friends or bots. Create a room, share the code on WhatsApp and play from different phones.',
    open: data.open, mine: data.mine, top: data.top, maxActive: L.MAX_ACTIVE,
    err: oneLine(req.query.err, 160), ok: oneLine(req.query.ok, 160),
  });
}));

router.post('/ludo/new', wrapPage(async (req, res) => {
  const u = req.session.user;
  if (!u) return needLogin(req, res);
  const made = await L.create(u, parseInt(req.body.max, 10), req.body.visibility === 'public' ? 'public' : 'private');
  if (made.error) return back(res, '/ludo', 'err', made.error);
  res.redirect('/ludo/' + made.row.code);
}));

router.post('/ludo/join', wrapPage(async (req, res) => {
  const u = req.session.user;
  if (!u) return needLogin(req, res);
  const code = cleanCode(req.body.code);
  if (!code) return back(res, '/ludo', 'err', 'Please enter the 5-letter room code.');
  const row = await L.find(code);
  if (!row) return back(res, '/ludo', 'err', 'No room with that code.');
  res.redirect(`/ludo/${code}?join=1`);
}));

// The game page (lobby + board in one page)
router.get('/ludo/:code', wrapPage(async (req, res, next) => {
  const u = req.session.user;
  if (!u) return needLogin(req, res);
  const code = cleanCode(req.params.code);
  const row = code ? await L.find(code) : null;
  if (!row) return res.status(404).render('404', { title: 'Room not found', message: 'This Ludo room does not exist any more. Rooms are removed after a few hours.' });
  res.locals.robots = 'noindex,nofollow';
  const init = {
    code, state: await L.view(row, u.id), board: L.BOARD, colors: L.COLOR_NAMES,
    uid: u.id, autoJoin: req.query.join === '1', maxActive: L.MAX_ACTIVE,
    emojis: L.CHAT_EMOJIS, chatMax: L.CHAT_MAX_LEN,
    prefs: await L.getPrefs(u.id),
  };
  res.render('ludo-game', { title: `Ludo room ${code} | Khabzo`, metaDescription: 'Ludo room', code, init });
}));

// Look & sound preferences (theme, dice skin, token skin, sound). JSON + x-csrf-token header.
router.post('/ludo/prefs', wrapJson(async (req, res) => {
  const u = req.session.user;
  if (!u) return res.status(401).json({ error: 'Please log in again.' });
  res.json({ prefs: await L.savePrefs(u.id, req.body) });
}));

router.post('/ludo/:code/act', wrapJson(async (req, res) => {
  const u = req.session.user;
  if (!u) return res.status(401).json({ error: 'Please log in again.' });
  const code = cleanCode(req.params.code);
  if (!code) return res.status(404).json({ error: 'Game not found.' });
  const out = await L.act(code, u, req.body || {});
  if (out.error) return res.status(400).json({ error: out.error });
  res.json(out);
}));

// State polling. app.js mounts this BEFORE the page middleware (it skips the nav / ads queries a poll never needs).
router.pollHandler = wrapJson(async (req, res) => {
  const u = req.session && req.session.user;
  if (!u) return res.status(401).json({ error: 'Please log in again.' });
  const code = cleanCode(req.params.code);
  const st = code ? await L.poll(code, u.id) : null;
  if (!st) return res.status(404).json({ error: 'Game not found.' });
  res.set('Cache-Control', 'no-store');
  const since = parseInt(req.query.since, 10);
  if (since === st.v) return res.json({ same: true, v: st.v, now: st.now, nextIn: st.nextIn, deadline: st.deadline });
  res.json(st);
});

module.exports = router;
