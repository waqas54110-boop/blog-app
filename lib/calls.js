// Voice / video call ka server-side logic. Media browsers ke darmiyan seedha (WebRTC) jata hai;
// server sirf "signaling" (offer / answer / ICE) aur call ki halat (ringing, active...) sambhalta hai.
const pool = require('../db');
const { notifyUser } = require('./notify');

const RING_SECS = 45;      // itni der ghanti, phir "missed"
const STALE_RING = 15;     // ghanti ke dauran caller itni der khamosh ho to wo chala gaya
const STALE_ACTIVE = 25;   // call ke dauran koi side itni der khamosh ho to call khatam

// STUN free hai; mobile data / strict NAT par TURN bhi chahiye (env mein dein, SETUP_V26.md dekhein)
function iceServers() {
  const stun = (process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const list = [{ urls: stun }];
  const turn = (process.env.TURN_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (turn.length && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    list.push({ urls: turn, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
  }
  return list;
}

// Ages seconds mein (float8 taake pg number de, string nahi)
const AGES = `EXTRACT(EPOCH FROM (now() - created_at))::float8 AS age,
  EXTRACT(EPOCH FROM (now() - caller_seen))::float8 AS caller_age,
  COALESCE(EXTRACT(EPOCH FROM (now() - callee_seen)), 0)::float8 AS callee_age`;

function staleStatus(c) {
  if (c.status === 'ringing') {
    if (c.age > RING_SECS) return 'missed';
    if (c.caller_age > STALE_RING) return 'cancelled';
  }
  if (c.status === 'active' && (c.caller_age > STALE_ACTIVE || c.callee_age > STALE_ACTIVE)) return 'ended';
  return null;
}

const fmtSecs = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

// Call ko khatam karo (sirf ek hi dafa kamyab hota hai) aur chat mein ek line likh do.
async function finish(callId, status, { stale = false } = {}) {
  const endedAt = stale ? 'LEAST(now(), GREATEST(caller_seen, COALESCE(callee_seen, caller_seen)))' : 'now()';
  const r = await pool.query(
    `UPDATE calls SET status = $2, ended_at = ${endedAt}
     WHERE id = $1 AND status IN ('ringing', 'active')
     RETURNING id, caller_id, callee_id, kind, answered_at,
       CASE WHEN answered_at IS NULL THEN 0
            ELSE GREATEST(0, EXTRACT(EPOCH FROM (ended_at - answered_at)))::int END AS secs`,
    [callId, status]
  );
  const c = r.rows[0];
  if (!c) return null;

  try {
    const icon = c.kind === 'video' ? '🎥' : '📞';
    const label = c.kind === 'video' ? 'video call' : 'voice call';
    const Label = label.charAt(0).toUpperCase() + label.slice(1);
    let body;
    if (status === 'ended' && c.answered_at) body = `${icon} ${Label} · ${fmtSecs(c.secs)}`;
    else if (status === 'declined') body = `${icon} ${Label} declined`;
    else body = `${icon} Missed ${label}`;

    await pool.query('INSERT INTO messages (sender_id, receiver_id, body) VALUES ($1, $2, $3)', [c.caller_id, c.callee_id, body]);

    if (!c.answered_at && status !== 'declined') {
      const who = (await pool.query('SELECT username FROM users WHERE id = $1', [c.caller_id])).rows[0];
      if (who) notifyUser(c.callee_id, `${icon} Missed ${label} from ${who.username}`, `/messages/${encodeURIComponent(who.username)}`);
    }
  } catch (err) {
    console.error('[calls] chat log:', err.message);
  }
  return c;
}

// Kya ye banda abhi kisi (zinda) call mein hai ya kisi ko ring ho rahi hai?
async function isBusy(uid) {
  const r = await pool.query(
    `SELECT 1 FROM calls WHERE (caller_id = $1 OR callee_id = $1) AND (
       (status = 'ringing' AND created_at > now() - interval '${RING_SECS} seconds' AND caller_seen > now() - interval '${STALE_RING} seconds')
       OR (status = 'active' AND caller_seen > now() - interval '${STALE_ACTIVE} seconds'
           AND COALESCE(callee_seen, now()) > now() - interval '${STALE_ACTIVE} seconds')
     ) LIMIT 1`,
    [uid]
  );
  return r.rowCount > 0;
}

// Purane atke hue rows saaf (call shuru karte waqt chalta hai)
async function janitor() {
  await pool.query(`UPDATE calls SET status = 'missed', ended_at = now() WHERE status = 'ringing' AND created_at < now() - interval '5 minutes'`);
  await pool.query(`UPDATE calls SET status = 'ended', ended_at = now()
                    WHERE status = 'active' AND GREATEST(caller_seen, COALESCE(callee_seen, caller_seen)) < now() - interval '5 minutes'`);
  await pool.query(`DELETE FROM call_signals WHERE created_at < now() - interval '1 day'`);
}

module.exports = { iceServers, AGES, staleStatus, finish, isBusy, janitor, RING_SECS };
