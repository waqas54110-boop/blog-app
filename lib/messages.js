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

// ---------- V41: reply / reactions / unsend ----------
// Naye columns (migration_v41.sql) chali hon to features on; warna chat purane tareeqe se chalta rehta hai.
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
let v41 = { ok: false, at: 0 };
async function features() {
  if (v41.ok) return true;
  if (Date.now() - v41.at < 20000) return false;
  v41.at = Date.now();
  try {
    const r = await pool.query(
      `SELECT (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'messages' AND column_name IN ('reply_to', 'deleted_at')) AS c,
              (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'message_reactions') AS t`
    );
    v41.ok = Number(r.rows[0].c) === 2 && Number(r.rows[0].t) === 1;
  } catch (e) { v41.ok = false; }
  return v41.ok;
}

// reply_to sirf isi chat ka (aur delete na hua) message ho sakta hai
async function validReply(meId, otherId, id) {
  const n = /^\d{1,9}$/.test(String(id || '')) ? parseInt(id, 10) : 0;
  if (!n || !(await features())) return null;
  const r = await pool.query(`SELECT m.id FROM messages m WHERE m.id = $3 AND ${PAIR} AND m.deleted_at IS NULL`, [meId, otherId, n]);
  return r.rowCount ? n : null;
}

// Messages ke saath unki reactions jodna: [{ e, c, mine }]
async function attachReactions(rows, meId) {
  if (!rows.length || !(await features())) return rows;
  const r = await pool.query(
    `SELECT message_id, emoji, COUNT(*)::int AS c, bool_or(user_id = $2) AS mine
     FROM message_reactions WHERE message_id = ANY($1::int[]) GROUP BY message_id, emoji ORDER BY message_id, MIN(created_at)`,
    [rows.map((m) => m.id), meId]
  );
  const by = {};
  r.rows.forEach((x) => { (by[x.message_id] = by[x.message_id] || []).push({ e: x.emoji, c: x.c, mine: x.mine }); });
  return rows.map((m) => ({ ...m, reactions: by[m.id] || [] }));
}

// Poll ke liye: aakhri 100 messages mein se kaun delete hue + sab ki reactions
async function syncState(meId, otherId) {
  if (!(await features())) return null;
  const win = await pool.query(
    `SELECT t.id, t.deleted_at IS NOT NULL AS del FROM (SELECT m.id, m.deleted_at FROM messages m WHERE ${PAIR} ORDER BY m.id DESC LIMIT 100) t`,
    [meId, otherId]
  );
  if (!win.rowCount) return { deleted: [], reactions: {}, winMin: 0 };
  const ids = win.rows.map((x) => x.id);
  const rx = await pool.query(
    `SELECT message_id, emoji, COUNT(*)::int AS c, bool_or(user_id = $2) AS mine
     FROM message_reactions WHERE message_id = ANY($1::int[]) GROUP BY message_id, emoji ORDER BY message_id, MIN(created_at)`,
    [ids, meId]
  );
  const reactions = {};
  rx.rows.forEach((x) => { (reactions[x.message_id] = reactions[x.message_id] || []).push({ e: x.emoji, c: x.c, mine: x.mine }); });
  return { deleted: win.rows.filter((x) => x.del).map((x) => x.id), reactions, winMin: Math.min(...ids) };
}

// Reaction lagao / hatao (wahi emoji dobara = hata do). Wapas { reactions } ya { error }
async function react(me, other, messageId, emoji) {
  if (!(await features())) return { error: 'Reactions are not enabled yet.' };
  if (!REACTIONS.includes(emoji)) return { error: 'Unknown reaction.' };
  const id = /^\d{1,9}$/.test(String(messageId || '')) ? parseInt(messageId, 10) : 0;
  const m = id ? await pool.query(`SELECT m.id, m.sender_id FROM messages m WHERE m.id = $3 AND ${PAIR} AND m.deleted_at IS NULL`, [me.id, other.id, id]) : { rowCount: 0 };
  if (!m.rowCount) return { error: 'Message not found.' };
  const cur = await pool.query('SELECT emoji FROM message_reactions WHERE message_id = $1 AND user_id = $2', [id, me.id]);
  let added = false;
  if (cur.rowCount && cur.rows[0].emoji === emoji) {
    await pool.query('DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2', [id, me.id]);
  } else {
    await pool.query(
      `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)
       ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji, created_at = now()`,
      [id, me.id, emoji]
    );
    added = !cur.rowCount;
  }
  if (added && m.rows[0].sender_id === other.id) {
    notifyUser(other.id, `${emoji} ${me.username} reacted to your message`, `/messages/${encodeURIComponent(me.username)}#m${id}`);
  }
  const rows = await attachReactions([{ id }], me.id);
  return { reactions: rows[0].reactions };
}

// Apna message sab ke liye delete (unsend). Open report wala message delete nahi hota (saboot rehta hai).
async function unsend(me, other, messageId) {
  if (!(await features())) return { error: 'Delete is not enabled yet.' };
  const id = /^\d{1,9}$/.test(String(messageId || '')) ? parseInt(messageId, 10) : 0;
  const r = id ? await pool.query(
    `SELECT m.id, m.media_id FROM messages m WHERE m.id = $3 AND m.sender_id = $1 AND m.receiver_id = $2 AND m.deleted_at IS NULL`,
    [me.id, other.id, id]
  ) : { rowCount: 0 };
  if (!r.rowCount) return { error: 'Message not found.' };
  const rep = await pool.query("SELECT 1 FROM reports WHERE target_type = 'message' AND target_id = $1 AND status = 'open' LIMIT 1", [id]);
  if (rep.rowCount) return { error: 'This message has been reported, so it can\'t be deleted right now.' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("UPDATE messages SET deleted_at = now(), body = '', media_id = NULL, reply_to = NULL WHERE id = $1", [id]);
    await client.query('DELETE FROM message_reactions WHERE message_id = $1', [id]);
    if (r.rows[0].media_id) await client.query('DELETE FROM message_media WHERE id = $1', [r.rows[0].media_id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { ok: true };
}

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
  const v = await features();
  const extraCols = v
    ? ', m.deleted_at, m.reply_to, rm.sender_id AS r_sender, rm.body AS r_body, rmm.kind AS r_kind, (rm.deleted_at IS NOT NULL) AS r_deleted'
    : '';
  const extraJoins = v
    ? 'LEFT JOIN messages rm ON rm.id = m.reply_to LEFT JOIN message_media rmm ON rmm.id = rm.media_id'
    : '';
  const outer = v ? ', deleted_at, reply_to, r_sender, r_body, r_kind, r_deleted' : '';
  const r = await pool.query(
    `SELECT id, sender_id, body, created_at, read_at, media_id, media_kind, media_secs${outer} FROM (
       SELECT m.id, m.sender_id, m.body, m.created_at, m.read_at, m.media_id, mm.kind AS media_kind, mm.duration AS media_secs${extraCols}
       FROM messages m LEFT JOIN message_media mm ON mm.id = m.media_id ${extraJoins}
       WHERE ${PAIR} AND m.id > $3 ORDER BY m.id DESC LIMIT $4
     ) t ORDER BY id`,
    [meId, otherId, afterId, limit]
  );
  return attachReactions(r.rows, meId);
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

async function send(me, other, body, replyTo) {
  const notify = await shouldNotify(me, other);
  const reply = await validReply(me.id, other.id, replyTo);
  const r = reply
    ? await pool.query(
        'INSERT INTO messages (sender_id, receiver_id, body, reply_to) VALUES ($1, $2, $3, $4) RETURNING id, created_at',
        [me.id, other.id, body, reply])
    : await pool.query(
        'INSERT INTO messages (sender_id, receiver_id, body) VALUES ($1, $2, $3) RETURNING id, created_at',
        [me.id, other.id, body]);
  if (notify) {
    notifyUser(other.id, `💬 ${me.username} sent you a message`, `/messages/${encodeURIComponent(me.username)}`);
  }
  return r.rows[0];
}

// Photo ya voice message: file aur message ek hi transaction mein
async function sendMedia(me, other, { buf, kind, mime, duration, replyTo }) {
  const notify = await shouldNotify(me, other);
  const reply = await validReply(me.id, other.id, replyTo);
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
      reply
        ? "INSERT INTO messages (sender_id, receiver_id, body, media_id, reply_to) VALUES ($1, $2, '', $3, $4) RETURNING id, created_at"
        : "INSERT INTO messages (sender_id, receiver_id, body, media_id) VALUES ($1, $2, '', $3) RETURNING id, created_at",
      reply ? [me.id, other.id, mm.rows[0].id, reply] : [me.id, other.id, mm.rows[0].id]
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
  const v = await features();
  const r = await pool.query(
    `SELECT u.id, u.username, lm.body, lm.media_kind, lm.created_at, lm.sender_id AS last_sender, ${v ? '(lm.deleted_at IS NOT NULL)' : 'false'} AS last_deleted, COALESCE(un.c, 0) AS unread
     FROM friend_requests fr
     JOIN users u ON u.id = CASE WHEN fr.sender_id = $1 THEN fr.receiver_id ELSE fr.sender_id END
     LEFT JOIN LATERAL (
       SELECT m.body, m.created_at, m.sender_id, ${v ? 'm.deleted_at' : 'NULL::timestamptz AS deleted_at'}, mm.kind AS media_kind FROM messages m
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
  REACTIONS, features, validReply, syncState, react, unsend,
  areFriends, canChat, detectMedia, thread, markRead, seenUpTo, clean, send, sendMedia, mediaMeta, conversations, unreadTotal,
};
