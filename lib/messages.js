// Private messages: sirf friends ke darmiyan, block ho to nahi.
const pool = require('../db');
const Blocks = require('./blocks');
const { notifyUser } = require('./notify');

const MAX_LEN = 1000;
const MAX_LINKS = 2;

// (a, b) ki dosti accept ho chuki hai?
async function areFriends(a, b) {
  const r = await pool.query(
    `SELECT 1 FROM friend_requests WHERE status = 'accepted'
     AND ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)) LIMIT 1`,
    [a, b]
  );
  return r.rowCount > 0;
}

// 'ok' | 'blocked' | 'not_friends'
async function canChat(me, other) {
  if (await Blocks.isBlockedEither(me, other)) return 'blocked';
  return (await areFriends(me, other)) ? 'ok' : 'not_friends';
}

const PAIR = `((m.sender_id = $1 AND m.receiver_id = $2) OR (m.sender_id = $2 AND m.receiver_id = $1))`;

async function thread(meId, otherId, afterId = 0, limit = 100) {
  const r = await pool.query(
    `SELECT id, sender_id, body, created_at FROM (
       SELECT m.id, m.sender_id, m.body, m.created_at FROM messages m
       WHERE ${PAIR} AND m.id > $3 ORDER BY m.id DESC LIMIT $4
     ) t ORDER BY id`,
    [meId, otherId, afterId, limit]
  );
  return r.rows;
}

async function markRead(meId, otherId) {
  await pool.query(
    'UPDATE messages SET read_at = now() WHERE receiver_id = $1 AND sender_id = $2 AND read_at IS NULL',
    [meId, otherId]
  );
}

// Message saaf karke (galat ho to { error }), warna { body }
function clean(raw) {
  const body = String(raw || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (!body) return { error: 'Please type a message.' };
  if (body.length > MAX_LEN) return { error: `Message is too long (max ${MAX_LEN} characters).` };
  if ((body.match(/https?:\/\//gi) || []).length > MAX_LINKS) return { error: `Please send at most ${MAX_LINKS} links in one message.` };
  return { body };
}

async function send(me, other, body) {
  // Pehle se unread hai to naya notification nahi (har message par 🔔 ka toofan na aaye)
  const had = await pool.query(
    'SELECT 1 FROM messages WHERE sender_id = $1 AND receiver_id = $2 AND read_at IS NULL LIMIT 1', [me.id, other.id]
  );
  const r = await pool.query(
    'INSERT INTO messages (sender_id, receiver_id, body) VALUES ($1, $2, $3) RETURNING id, created_at',
    [me.id, other.id, body]
  );
  if (!had.rowCount) {
    notifyUser(other.id, `💬 ${me.username} sent you a message`, `/messages/${encodeURIComponent(me.username)}`);
  }
  return r.rows[0];
}

// Friends ki list: aakhri message + unread ginti, naye message wale upar
async function conversations(meId) {
  const r = await pool.query(
    `SELECT u.id, u.username, lm.body, lm.created_at, lm.sender_id AS last_sender, COALESCE(un.c, 0) AS unread
     FROM friend_requests fr
     JOIN users u ON u.id = CASE WHEN fr.sender_id = $1 THEN fr.receiver_id ELSE fr.sender_id END
     LEFT JOIN LATERAL (
       SELECT m.body, m.created_at, m.sender_id FROM messages m WHERE ${PAIR.split('$2').join('u.id')} ORDER BY m.id DESC LIMIT 1
     ) lm ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS c FROM messages m WHERE m.sender_id = u.id AND m.receiver_id = $1 AND m.read_at IS NULL
     ) un ON true
     WHERE fr.status = 'accepted' AND (fr.sender_id = $1 OR fr.receiver_id = $1)
       AND NOT ${Blocks.blockedEitherSql('$1', 'u.id')}
     ORDER BY lm.created_at DESC NULLS LAST, lower(u.username) LIMIT 200`,
    [meId]
  );
  return r.rows;
}

// Header ka badge: sirf friends ke (aur block na kiye hue) unread messages
async function unreadTotal(meId) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c FROM messages m
     WHERE m.receiver_id = $1 AND m.read_at IS NULL
       AND EXISTS (SELECT 1 FROM friend_requests fr WHERE fr.status = 'accepted'
                   AND ((fr.sender_id = m.sender_id AND fr.receiver_id = m.receiver_id) OR (fr.sender_id = m.receiver_id AND fr.receiver_id = m.sender_id)))
       AND NOT ${Blocks.blockedEitherSql('m.receiver_id', 'm.sender_id')}`,
    [meId]
  );
  return r.rows[0].c;
}

module.exports = { MAX_LEN, areFriends, canChat, thread, markRead, clean, send, conversations, unreadTotal };
