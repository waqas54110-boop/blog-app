// Voice / video call (/calls/...): signaling. Sirf friends (Msg.canChat) aapas mein call kar sakte hain.
const express = require('express');
const pool = require('../db');
const Msg = require('../lib/messages');
const Calls = require('../lib/calls');
const { notifyUser } = require('../lib/notify');

const router = express.Router();

router.use('/calls', (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Please log in again.' });
  next();
});

const toId = (v) => (/^\d{1,12}$/.test(String(v)) ? parseInt(v, 10) : null);
const fail = (res, code, msg, extra = {}) => res.status(code).json({ error: msg, ...extra });
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  // 42P01 = table nahi hai: migration_v24.sql abhi chali nahi. Har tab ke poll par log na bharein.
  if (err.code === '42P01') {
    if (req.path === '/calls/incoming') return res.json({ call: null });
    if (!wrap.warned) { wrap.warned = true; console.error('[calls] "calls" table nahi mili: Neon mein migration_v24.sql run karein.'); }
    if (!res.headersSent) res.status(503).json({ error: 'Calls are not set up yet. The site owner needs to run migration_v24.sql.' });
    return;
  }
  console.error('[calls]', err.message);
  if (!res.headersSent) res.status(500).json({ error: 'Server error, please try again.' });
});

async function loadMine(id, uid) {
  const r = await pool.query(`SELECT *, ${Calls.AGES} FROM calls WHERE id = $1 AND (caller_id = $2 OR callee_id = $2)`, [id, uid]);
  return r.rows[0] || null;
}

router.get('/calls/ice', (req, res) => res.json({ ice: Calls.iceServers() }));

// Mujhe koi call aa rahi hai? (browser har kuch second poochta hai)
router.get('/calls/incoming', wrap(async (req, res) => {
  const me = req.session.user.id;
  const r = await pool.query(
    `SELECT c.id, c.kind, c.status, u.username AS from_name, ${Calls.AGES.replace(/created_at/g, 'c.created_at').replace(/caller_seen/g, 'c.caller_seen').replace(/callee_seen/g, 'c.callee_seen')}
     FROM calls c JOIN users u ON u.id = c.caller_id
     WHERE c.callee_id = $1 AND c.status = 'ringing' ORDER BY c.id DESC LIMIT 5`,
    [me]
  );
  for (const row of r.rows) {
    const st = Calls.staleStatus(row);
    if (st) { await Calls.finish(row.id, st, { stale: true }); continue; }
    return res.json({ call: { id: row.id, kind: row.kind, from: row.from_name } });
  }
  res.json({ call: null });
}));

router.post('/calls/start', wrap(async (req, res) => {
  const me = req.session.user;
  const kind = req.body && req.body.kind === 'video' ? 'video' : req.body && req.body.kind === 'audio' ? 'audio' : null;
  const name = String((req.body && req.body.username) || '').slice(0, 50);
  if (!kind || !name) return fail(res, 400, 'Invalid call request.');

  const other = (await pool.query('SELECT id, username FROM users WHERE lower(username) = lower($1) ORDER BY id LIMIT 1', [name])).rows[0];
  if (!other || other.id === me.id) return fail(res, 404, 'User not found.');
  if ((await Msg.canChat(me.id, other.id)) !== 'ok') return fail(res, 403, 'You can only call your friends.');

  await Calls.janitor().catch(() => {});
  if (await Calls.isBusy(me.id)) return fail(res, 409, 'You are already in a call.');
  if (await Calls.isBusy(other.id)) return fail(res, 409, `${other.username} is on another call. Try again in a bit.`, { busy: true });

  const r = await pool.query('INSERT INTO calls (caller_id, callee_id, kind) VALUES ($1, $2, $3) RETURNING id', [me.id, other.id, kind]);
  notifyUser(other.id, `${kind === 'video' ? '🎥' : '📞'} ${me.username} is calling you`, `/messages/${encodeURIComponent(me.username)}`);
  res.json({ id: r.rows[0].id, ice: Calls.iceServers() });
}));

router.post('/calls/:id/accept', wrap(async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return fail(res, 404, 'Call not found.');
  const r = await pool.query(
    `UPDATE calls SET status = 'active', answered_at = now(), callee_seen = now()
     WHERE id = $1 AND callee_id = $2 AND status = 'ringing' AND created_at > now() - interval '60 seconds'
       AND caller_seen > now() - interval '20 seconds'
     RETURNING kind`,
    [id, req.session.user.id]
  );
  if (!r.rowCount) return fail(res, 409, 'This call is no longer available.');
  res.json({ ok: true, kind: r.rows[0].kind, ice: Calls.iceServers() });
}));

router.post('/calls/:id/signal', wrap(async (req, res) => {
  const id = toId(req.params.id);
  const me = req.session.user.id;
  const type = req.body && req.body.type;
  const payload = req.body && req.body.payload;
  if (!id || !['offer', 'answer', 'ice'].includes(type) || typeof payload !== 'string' || !payload || payload.length > 40000) {
    return fail(res, 400, 'Invalid signal.');
  }
  const c = await loadMine(id, me);
  if (!c || !['ringing', 'active'].includes(c.status)) return fail(res, 409, 'Call has ended.');
  if (type === 'offer' && c.caller_id !== me) return fail(res, 403, 'Not allowed.');
  if (type === 'answer' && c.callee_id !== me) return fail(res, 403, 'Not allowed.');
  await pool.query('INSERT INTO call_signals (call_id, from_user, type, payload) VALUES ($1, $2, $3, $4)', [id, me, type, payload]);
  res.json({ ok: true });
}));

// Call ki halat + doosri taraf ke naye signals. Ye call hi "main zinda hoon" ka ishara bhi hai.
router.get('/calls/:id/poll', wrap(async (req, res) => {
  const id = toId(req.params.id);
  const me = req.session.user.id;
  if (!id) return fail(res, 404, 'Call not found.');
  const probe = await loadMine(id, me);
  if (!probe) return fail(res, 404, 'Call not found.');

  const col = probe.caller_id === me ? 'caller_seen' : 'callee_seen';
  const u = await pool.query(`UPDATE calls SET ${col} = now() WHERE id = $1 AND status IN ('ringing', 'active') RETURNING id`, [id]);
  const c = u.rowCount ? await loadMine(id, me) : probe;

  if (c.status === 'ringing' || c.status === 'active') {
    const st = Calls.staleStatus(c);
    if (st) {
      await Calls.finish(id, st, { stale: true });
      const now = await loadMine(id, me);
      return res.json({ status: now ? now.status : st, signals: [] });
    }
  } else {
    return res.json({ status: c.status, signals: [] });
  }

  const after = /^\d{1,15}$/.test(String(req.query.after || '')) ? String(req.query.after) : '0';
  const s = await pool.query(
    'SELECT id, type, payload FROM call_signals WHERE call_id = $1 AND from_user <> $2 AND id > $3 ORDER BY id LIMIT 60',
    [id, me, after]
  );
  res.json({
    status: c.status,
    signals: s.rows.map((x) => ({ id: Number(x.id), type: x.type, payload: x.payload })),
  });
}));

// Call khatam: ghanti ke dauran caller ka = cancel, callee ka = decline; baat chal rahi ho to ended
router.post('/calls/:id/end', wrap(async (req, res) => {
  const id = toId(req.params.id);
  const me = req.session.user.id;
  if (!id) return fail(res, 404, 'Call not found.');
  const c = await loadMine(id, me);
  if (!c) return fail(res, 404, 'Call not found.');
  if (c.status === 'ringing') await Calls.finish(id, c.caller_id === me ? 'cancelled' : 'declined');
  else if (c.status === 'active') await Calls.finish(id, 'ended');
  res.json({ ok: true });
}));

module.exports = router;