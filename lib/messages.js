// Private messages: sirf friends ke darmiyan, block ho to nahi. Text, photo aur voice message.
const pool = require('../db');
const Blocks = require('./blocks');
const { notifyUser } = require('./notify');

const MAX_LEN = 1000;
const MAX_LINKS = 2;
const IMAGE_MAX = 2 * 1024 * 1024;   // browser pehle 1280px JPEG bana deta hai
const VOICE_MAX = 3 * 1024 * 1024;
const VOICE_MAX_SECS = 120;

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

// Photo / voice ki asli pehchan pehle bytes se (browser ke content-type par bharosa nahi). Wapas { kind, mime } ya null
function detectMedia(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { kind: 'image', mime: 'image/jpeg' };
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { kind: 'voice', mime: 'audio/webm' };
  if (buf.subarray(0, 4).toString('latin1') === 'OggS') return { kind: 'voice', mime: 'audio/ogg' };
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') return { kind: 'voice', mime: 'audio/mp4' };
  return null;
}

// Naye aur purane dono messages: media ka sirf kind / seconds aata hai, file ka data nahi
async function thread(meId, otherId, afterId = 0, limit = 100) {
  const r = await pool.query(
    `SELECT id, sender_id, body, created_at, read_at, media_id, media_kind, media_secs FROM (
       SELECT m.id, m.sender_id, m.body, m.created_at, m.read_at, m.media_id, mm.kind AS media_kind, mm.duration AS media_secs
       FROM messages m LEFT JOIN message_media mm ON mm.id = m.media_id
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

// Mere bheje hue messages mein se sab se naya id jo samne wale ne dekh liya ("seen" ✓✓ tak)
async function seenUpTo(meId, otherId) {
  const r = await pool.query(
    'SELECT COALESCE(MAX(id), 0)::int AS n FROM messages WHERE sender_id = $1 AND receiver_id = $2 AND read_at IS NOT NULL',
    [meId, otherId]
  );
  return r.rows[0].n;
}

// Message saaf karke (galat ho to { error }), warna { body }
function clean(raw) {
  const body = String(raw || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (!body) return { error: 'Please type a message.' };
  if (body.length > MAX_LEN) return { error: `Message is too long (max ${MAX_LEN} characters).` };
  if ((body.match(/https?:\/\//gi) || []).length > MAX_LINKS) return { error: `Please send at most ${MAX_LINKS} links in one message.` };
  return { body };
}

// Pehle se unread hai to naya notification nahi (har message par 🔔 ka toofan na aaye)
async function shouldNotify(me, other) {
  const had = await pool.query(
    'SELECT 1 FROM messages WHERE sender_id = $1 AND receiver_id = $2 AND read_at IS NULL LIMIT 1', [me.id, other.id]
  );
  return !had.rowCount;
}

async function send(me, other, body) {
  const notify = await shouldNotify(me, other);
  const r = await pool.query(
    'INSERT INTO messages (sender_id, receiver_id, body) VALUES ($1, $2, $3) RETURNING id, created_at',
    [me.id, other.id, body]
  );
  if (notify) {
    notifyUser(other.id, `💬 ${me.username} sent you a message`, `/messages/${encodeURIComponent(me.username)}`);
  }
  return r.rows[0];
}

// Photo ya voice message: file aur message ek hi transaction mein
async function sendMedia(me, other, { buf, kind, mime, duration }) {
  const notify = await shouldNotify(me, other);
  const client = await pool.connect();
  let row;
  try {
    await client.query('BEGIN');
    const secs = kind === 'voice' ? Math.max(1, Math.min(VOICE_MAX_SECS, duration | 0 || 1)) : null;
    const mm = await client.query(
      'INSERT INTO message_media (uploader_id, kind, mime, data, size, duration) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [me.id, kind, mime, buf, buf.length, secs]
    );
    const m = await client.query(
      "INSERT INTO messages (sender_id, receiver_id, body, media_id) VALUES ($1, $2, '', $3) RETURNING id, created_at",
      [me.id, other.id, mm.rows[0].id]
    );
    await client.query('COMMIT');
    row = { id: m.rows[0].id, created_at: m.rows[0].created_at, media_id: mm.rows[0].id, media_kind: kind, media_secs: secs };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  if (notify) {
    notifyUser(other.id, `${kind === 'voice' ? '🎤' : '📷'} ${me.username} sent you a ${kind === 'voice' ? 'voice message' : 'photo'}`, `/messages/${encodeURIComponent(me.username)}`);
  }
  return row;
}

// Media sirf bhejne wale aur wasool karne wale ko (aur block na ho). Site admin ko sirf tab jab us message par open report ho.
// Wapas { mime, size } ya null
async function mediaMeta(mediaId, meId, isAdmin = false) {
  const r = await pool.query(
    `SELECT mm.mime, mm.size, m.id AS message_id, m.sender_id, m.receiver_id FROM message_media mm
     JOIN messages m ON m.media_id = mm.id WHERE mm.id = $1 LIMIT 1`,
    [mediaId]
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.sender_id !== meId && row.receiver_id !== meId) {
    if (!isAdmin) return null;
    const rep = await pool.query(
      "SELECT 1 FROM reports WHERE target_type = 'message' AND target_id = $1 AND status = 'open' LIMIT 1", [row.message_id]
    );
    return rep.rowCount ? { mime: row.mime, size: row.size } : null;
  }
  const other = row.sender_id === meId ? row.receiver_id : row.sender_id;
  if (await Blocks.isBlockedEither(meId, other)) return null;
  return { mime: row.mime, size: row.size };
}

// Friends ki list: aakhri message + unread ginti, naye message wale upar
async function conversations(meId) {
  const r = await pool.query(
    `SELECT u.id, u.username, lm.body, lm.media_kind, lm.created_at, lm.sender_id AS last_sender, COALESCE(un.c, 0) AS unread
     FROM friend_requests fr
     JOIN users u ON u.id = CASE WHEN fr.sender_id = $1 THEN fr.receiver_id ELSE fr.sender_id END
     LEFT JOIN LATERAL (
       SELECT m.body, m.created_at, m.sender_id, mm.kind AS media_kind FROM messages m
       LEFT JOIN message_media mm ON mm.id = m.media_id
       WHERE ${PAIR.split('$2').join('u.id')} ORDER BY m.id DESC LIMIT 1
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

module.exports = {
  MAX_LEN, IMAGE_MAX, VOICE_MAX, VOICE_MAX_SECS,
  areFriends, canChat, detectMedia, thread, markRead, seenUpTo, clean, send, sendMedia, mediaMeta, conversations, unreadTotal,
};
