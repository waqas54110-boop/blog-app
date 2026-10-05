// Live broadcasting (/live/...). Host: post box ka "🔴 Live" button. Viewer: post card ka "Watch live".
// Har viewer ka host se alag WebRTC connection hota hai (mesh), is liye viewers ki hadd config.liveMaxViewers hai.
const express = require('express');
const pool = require('../db');
const config = require('../config');
const Calls = require('../lib/calls');
const LK = require('../lib/livekit');
const { detectVideo } = require('./uploads');
const Live = require('../lib/live');
const Groups = require('../lib/groups');
const Blocks = require('../lib/blocks');
const spam = require('../lib/spam');
const { notifyUser } = require('../lib/notify');

const router = express.Router();
const BODY_MAX = 300;                      // live ka caption chhota rakhte hain
const DEFAULT_BODY = '🔴 Live video';

router.use('/live', (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Please log in again.' });
  next();
});

const toId = (v) => (/^\d{1,12}$/.test(String(v)) ? parseInt(v, 10) : null);
const fail = (res, code, msg, extra = {}) => res.status(code).json({ error: msg, ...extra });
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  // 42P01 = table nahi hai: migration_v27.sql abhi chali nahi
  if (err.code === '42P01') {
    if (!wrap.warned) { wrap.warned = true; console.error('[live] live tables nahi mili: Neon mein migration_v27.sql run karein.'); }
    if (!res.headersSent) res.status(503).json({ error: 'Live is not set up yet. The site owner needs to run migration_v27.sql.' });
    return;
  }
  console.error('[live]', err.message);
  if (!res.headersSent) res.status(500).json({ error: 'Server error, please try again.' });
});

const canGoLive = (req) => !config.liveAdminOnly || (req.session.user && req.session.user.role === 'admin');

router.get('/live/ice', (req, res) => res.json({ ice: Calls.iceServers() }));

// ---------- HOST: live shuru ----------
router.post('/live/start', wrap(async (req, res) => {
  const me = req.session.user;
  const isAdmin = me.role === 'admin';
  if (!canGoLive(req)) return fail(res, 403, 'Going live is not enabled for your account.');

  let groupId = null;
  if (req.body && req.body.group_id) {
    const gid = toId(req.body.group_id);
    const g = gid ? (await pool.query('SELECT id FROM groups WHERE id = $1', [gid])).rows[0] : null;
    if (!g) return fail(res, 404, 'Group not found.');
    if (!(await Groups.roleOf(g.id, me.id))) return fail(res, 403, 'Join this group first to go live in it.');
    groupId = g.id;
  }

  const typed = String((req.body && req.body.body) || '').replace(/\r\n/g, '\n').trim();
  if (typed.length > BODY_MAX) return fail(res, 400, `Caption is too long (max ${BODY_MAX} characters).`);
  if (typed) {
    const verdict = await spam.check(typed, { userId: me.id, isAdmin });
    if (verdict.action !== 'ok') return fail(res, 400, (verdict.message || 'This caption was not accepted.').replace('comment', 'caption'));
  }

  await Live.janitor().catch(() => {});
  // Is banday ka purana (bhoola hua) live band karo
  const old = await pool.query(`SELECT id FROM live_streams WHERE user_id = $1 AND status = 'live'`, [me.id]);
  for (const row of old.rows) await Live.end(row.id);

  const mode = (LK.enabled() && (await Live.hasV28())) ? 'sfu' : 'p2p';
  const client = await pool.connect();
  let streamId, postId;
  try {
    await client.query('BEGIN');
    const p = await client.query(
      'INSERT INTO feed_posts (user_id, body, group_id) VALUES ($1, $2, $3) RETURNING id',
      [me.id, typed || DEFAULT_BODY, groupId]
    );
    postId = p.rows[0].id;
    await client.query('SAVEPOINT sp');
    let s;
    try {
      s = await client.query('INSERT INTO live_streams (user_id, post_id, mode) VALUES ($1, $2, $3) RETURNING id', [me.id, postId, mode]);
    } catch (e) {
      // mode column nahi (migration_v28.sql nahi chali): sirf p2p mumkin hai
      if (e.code !== '42703' || mode !== 'p2p') throw e;
      await client.query('ROLLBACK TO SAVEPOINT sp');
      s = await client.query('INSERT INTO live_streams (user_id, post_id) VALUES ($1, $2) RETURNING id', [me.id, postId]);
    }
    streamId = s.rows[0].id;
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Followers ko batao (group ka live ho to nahi). Dheere se, response nahi rokta.
  if (!groupId) {
    pool.query('SELECT follower_id FROM follows WHERE followee_id = $1 LIMIT 100', [me.id])
      .then((r) => Promise.all(r.rows.map((x) => notifyUser(x.follower_id, `🔴 ${me.username} is live now`, `/feed/${postId}`))))
      .catch((err) => console.error('[live] followers notify:', err.message));
  }

  const out = { id: Number(streamId), post_id: postId, mode, ice: Calls.iceServers(), max: config.liveMaxViewers, rec_max_mb: config.liveRecordMaxMb };
  if (mode === 'sfu') {
    out.lk = LK.info({ identity: 'host' + me.id, name: me.username, room: LK.roomName(streamId), canPublish: true });
    out.max = config.liveSfuMaxViewers;
  }
  res.json(out);
}));

// ---------- HOST: poll (ye hi "main zinda hoon" ka ishara bhi hai) ----------
router.get('/live/:id/host', wrap(async (req, res) => {
  const id = toId(req.params.id);
  const me = req.session.user.id;
  if (!id) return fail(res, 404, 'Live not found.');
  const u = await pool.query(
    `UPDATE live_streams SET host_seen = now() WHERE id = $1 AND user_id = $2 AND status = 'live' RETURNING id`,
    [id, me]
  );
  if (!u.rowCount) {
    const s = await pool.query('SELECT status FROM live_streams WHERE id = $1 AND user_id = $2', [id, me]);
    if (!s.rows[0]) return fail(res, 404, 'Live not found.');
    return res.json({ status: 'ended', sessions: [], signals: [] });
  }
  const cur = await Live.load(id);
  if (cur && cur.mode === 'sfu') {
    return res.json({ status: 'live', viewers: await Live.viewerCount(id), sessions: [], signals: [] });
  }
  const after = /^\d{1,15}$/.test(String(req.query.after || '')) ? String(req.query.after) : '0';
  const sessions = await Live.activeSessions(id, config.liveMaxViewers);
  const s = await pool.query(
    `SELECT id, sess, type, payload FROM live_signals WHERE stream_id = $1 AND NOT from_host AND id > $2 ORDER BY id LIMIT 100`,
    [id, after]
  );
  res.json({
    status: 'live',
    viewers: sessions.length,
    sessions,
    signals: s.rows.map((x) => ({ id: Number(x.id), sess: Number(x.sess), type: x.type, payload: x.payload })),
  });
}));

router.post('/live/:id/end', wrap(async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return fail(res, 404, 'Live not found.');
  const own = await pool.query('SELECT 1 FROM live_streams WHERE id = $1 AND user_id = $2', [id, req.session.user.id]);
  if (!own.rowCount) return fail(res, 404, 'Live not found.');
  await Live.end(id);
  res.json({ ok: true });
}));

// ---------- VIEWER: join ----------
router.post('/live/:id/join', wrap(async (req, res) => {
  const id = toId(req.params.id);
  const me = req.session.user;
  if (!id) return fail(res, 404, 'Live not found.');
  await Live.janitor().catch(() => {});

  const s = await Live.load(id);
  if (!s || s.status !== 'live') return fail(res, 410, 'This live has ended.');
  if (s.user_id === me.id) return fail(res, 400, 'This is your own live.');

  // Post mujhe dikhna allowed ho (private group, review mein) aur koi block na ho
  const vis = await pool.query(
    `SELECT 1 FROM feed_posts f WHERE f.id = $1 AND (NOT f.is_hidden OR $3::boolean)
       AND ${Groups.visiblePostSql('f', '$2', '$3')}`,
    [s.post_id, me.id, me.role === 'admin']
  );
  if (!vis.rowCount) return fail(res, 403, 'This live is not available to you.');
  if (await Blocks.isBlockedEither(me.id, s.user_id)) return fail(res, 403, 'This live is not available to you.');

  // Isi banday ka purana session (reload / dobara join) band
  await pool.query('UPDATE live_viewers SET left_at = now() WHERE stream_id = $1 AND user_id = $2 AND left_at IS NULL', [id, me.id]);
  const sfu = s.mode === 'sfu' && LK.enabled();
  const maxV = sfu ? config.liveSfuMaxViewers : config.liveMaxViewers;
  const count = await Live.viewerCount(id);
  if (count >= maxV) {
    return fail(res, 409, `This live is full right now (max ${maxV} viewers). Try again in a bit.`, { full: true });
  }

  const r = await pool.query('INSERT INTO live_viewers (stream_id, user_id) VALUES ($1, $2) RETURNING id', [id, me.id]);
  await pool.query('UPDATE live_streams SET peak_viewers = GREATEST(peak_viewers, $2) WHERE id = $1', [id, count + 1]);
  const sess = Number(r.rows[0].id);
  const out = { sess, mode: sfu ? 'sfu' : 'p2p', ice: Calls.iceServers(), host: s.host_name, post_id: s.post_id };
  if (sfu) out.lk = LK.info({ identity: 'v' + sess, name: me.username, room: LK.roomName(id), canPublish: false });
  res.json(out);
}));

// ---------- VIEWER: poll ----------
router.get('/live/:id/watch', wrap(async (req, res) => {
  const id = toId(req.params.id);
  const sess = toId(req.query.sess);
  const me = req.session.user.id;
  if (!id || !sess) return fail(res, 404, 'Live not found.');

  const v = await pool.query(
    'UPDATE live_viewers SET seen = now() WHERE id = $1 AND stream_id = $2 AND user_id = $3 AND left_at IS NULL RETURNING id',
    [sess, id, me]
  );
  if (!v.rowCount) return res.json({ status: 'ended', signals: [], viewers: 0 });

  const s = await Live.load(id);
  if (!s) return fail(res, 404, 'Live not found.');
  if (s.status === 'live' && s.host_age > Live.HOST_STALE) { await Live.end(id); return res.json({ status: 'ended', signals: [], viewers: 0 }); }
  if (s.status !== 'live') return res.json({ status: 'ended', signals: [], viewers: 0 });

  if (s.mode === 'sfu') {
    // Media server mode: signaling nahi, sirf halat + viewers ki ginti. Kam bar poll hota hai (poll_ms)
    return res.json({ status: 'live', viewers: await Live.viewerCount(id), signals: [], poll_ms: 5000 });
  }
  const after = /^\d{1,15}$/.test(String(req.query.after || '')) ? String(req.query.after) : '0';
  const [sig, count] = await Promise.all([
    pool.query('SELECT id, type, payload FROM live_signals WHERE sess = $1 AND from_host AND id > $2 ORDER BY id LIMIT 60', [sess, after]),
    Live.viewerCount(id),
  ]);
  res.json({
    status: 'live',
    viewers: count,
    signals: sig.rows.map((x) => ({ id: Number(x.id), type: x.type, payload: x.payload })),
  });
}));

router.post('/live/:id/leave', wrap(async (req, res) => {
  const id = toId(req.params.id);
  const sess = toId(req.body && req.body.sess);
  if (id && sess) {
    await pool.query('UPDATE live_viewers SET left_at = now() WHERE id = $1 AND stream_id = $2 AND user_id = $3 AND left_at IS NULL', [sess, id, req.session.user.id]);
  }
  res.json({ ok: true });
}));

// ---------- dono taraf: signal bhejna ----------
router.post('/live/:id/signal', wrap(async (req, res) => {
  const id = toId(req.params.id);
  const me = req.session.user.id;
  const sess = toId(req.body && req.body.sess);
  const type = req.body && req.body.type;
  const payload = req.body && req.body.payload;
  if (!id || !sess || !['offer', 'answer', 'ice'].includes(type) || typeof payload !== 'string' || !payload || payload.length > 40000) {
    return fail(res, 400, 'Invalid signal.');
  }
  const r = await pool.query(
    `SELECT s.user_id AS host_id, s.status, v.user_id AS viewer_id, v.left_at
     FROM live_streams s JOIN live_viewers v ON v.stream_id = s.id
     WHERE s.id = $1 AND v.id = $2`,
    [id, sess]
  );
  const row = r.rows[0];
  if (!row || row.status !== 'live' || row.left_at) return fail(res, 409, 'Live has ended.');
  const fromHost = row.host_id === me;
  if (!fromHost && row.viewer_id !== me) return fail(res, 403, 'Not allowed.');
  if (type === 'offer' && !fromHost) return fail(res, 403, 'Not allowed.');
  if (type === 'answer' && fromHost) return fail(res, 403, 'Not allowed.');
  await pool.query('INSERT INTO live_signals (stream_id, sess, from_host, type, payload) VALUES ($1, $2, $3, $4, $5)', [id, sess, fromHost, type, payload]);
  res.json({ ok: true });
}));

// ---------- HOST: recording save (live khatam hone ke baad) ----------
// Body seedha video bytes (app.js mein express.raw). Host ka browser live ke dauran record karta hai aur end par yahan bhejta hai.
router.post('/live/:id/recording', wrap(async (req, res) => {
  const id = toId(req.params.id);
  const me = req.session.user.id;
  if (!id) return fail(res, 404, 'Live not found.');
  if (!config.liveRecordMaxMb) return fail(res, 403, 'Recording is turned off.');
  if (!(await Live.hasV28())) return fail(res, 503, 'Recording is not set up yet. The site owner needs to run migration_v28.sql.');
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length === 0) return fail(res, 400, 'No recording received.');
  const mime = detectVideo(buf);
  if (!mime) return fail(res, 400, 'Unsupported recording format.');

  const st = (await pool.query(
    `SELECT status, video_id, ended_at > now() - interval '15 minutes' AS fresh FROM live_streams WHERE id = $1 AND user_id = $2`,
    [id, me]
  )).rows[0];
  if (!st) return fail(res, 404, 'Live not found.');
  if (st.status === 'live') await Live.end(id);       // upload aa gayi to live khatam hi samjho
  else if (st.fresh === false) return fail(res, 410, 'This live ended too long ago to save a recording.');
  if (st.video_id) return fail(res, 409, 'A recording is already saved for this live.');

  const v = await pool.query('INSERT INTO videos (mime, data, size, uploaded_by) VALUES ($1, $2, $3, $4) RETURNING id', [mime, buf, buf.length, me]);
  const u = await pool.query('UPDATE live_streams SET video_id = $2 WHERE id = $1 AND video_id IS NULL RETURNING id', [id, v.rows[0].id]);
  if (!u.rowCount) {   // koi aur upload pehle pohanch gayi
    await pool.query('DELETE FROM videos WHERE id = $1', [v.rows[0].id]);
    return fail(res, 409, 'A recording is already saved for this live.');
  }
  res.json({ ok: true, video_id: v.rows[0].id });
}));

module.exports = router;
