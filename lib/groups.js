// Groups: har group ka apna naam, members aur apni feed (feed_posts jin par group_id laga ho).
const pool = require('../db');
const { slugify } = require('./slug');
const Blocks = require('./blocks');
const { notifyUser } = require('./notify');

const NAME_MAX = 40;
const NAME_MIN = 3;
const DESC_MAX = 300;
const MAX_OWNED = 5;
const RESERVED = new Set(['new', 'create', 'mine', 'all', 'join']);

async function uniqueSlug(name) {
  let base = slugify(name);
  if (base === 'post') base = 'group';
  if (RESERVED.has(base)) base += '-group';
  base = base.slice(0, 50);
  let candidate = base;
  for (let n = 2; ; n++) {
    const r = await pool.query('SELECT 1 FROM groups WHERE slug = $1', [candidate]);
    if (!r.rowCount) return candidate;
    candidate = `${base}-${n}`;
  }
}

async function bySlug(slug) {
  const r = await pool.query(
    `SELECT g.*, u.username AS owner_name,
            (SELECT COUNT(*)::int FROM group_members m WHERE m.group_id = g.id) AS members,
            (SELECT COUNT(*)::int FROM feed_posts f WHERE f.group_id = g.id AND NOT f.is_hidden) AS posts
     FROM groups g JOIN users u ON u.id = g.owner_id
     WHERE g.slug = $1`,
    [String(slug).slice(0, 60)]
  );
  return r.rows[0] || null;
}

// Invite token se group (token 32 hex characters ka hota hai)
async function byToken(token) {
  const r = await pool.query(
    `SELECT g.*, (SELECT COUNT(*)::int FROM group_members m WHERE m.group_id = g.id) AS members
     FROM groups g WHERE g.invite_token = $1`,
    [String(token).slice(0, 64)]
  );
  return r.rows[0] || null;
}

// 'admin' | 'member' | null
async function roleOf(groupId, userId) {
  if (!userId) return null;
  const r = await pool.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
  return r.rows[0] ? r.rows[0].role : null;
}

// Groups ki list. me: mere groups pehle. q: naam / description mein talaash
async function list({ me, q, limit = 60 }) {
  const params = [me || 0];
  let where = '';
  if (q) { params.push('%' + q.replace(/[%_\\]/g, '\\$&') + '%'); where = `WHERE (g.name ILIKE $2 OR g.description ILIKE $2)`; }
  const r = await pool.query(
    `SELECT g.id, g.slug, g.name, g.description, g.emoji, g.owner_id, g.is_private,
            (SELECT COUNT(*)::int FROM group_members m WHERE m.group_id = g.id) AS members,
            (SELECT COUNT(*)::int FROM feed_posts f WHERE f.group_id = g.id AND NOT f.is_hidden) AS posts,
            EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = $1) AS joined,
            EXISTS (SELECT 1 FROM group_join_requests r WHERE r.group_id = g.id AND r.user_id = $1) AS requested
     FROM groups g ${where}
     ORDER BY joined DESC, members DESC, g.id ASC
     LIMIT ${Math.max(1, Math.min(100, limit))}`,
    params
  );
  return r.rows;
}

async function popular(limit = 5, me = 0) {
  const r = await pool.query(
    `SELECT * FROM (
       SELECT g.slug, g.name, g.emoji, g.is_private,
              (SELECT COUNT(*)::int FROM group_members m WHERE m.group_id = g.id) AS members,
              EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = $2) AS joined
       FROM groups g
     ) t WHERE NOT t.is_private OR t.joined
     ORDER BY members DESC, slug ASC LIMIT $1`,
    [limit, me || 0]
  );
  return r.rows;
}

async function memberPreview(groupId, limit = 12) {
  const r = await pool.query(
    `SELECT u.username, m.role FROM group_members m JOIN users u ON u.id = m.user_id
     WHERE m.group_id = $1 ORDER BY (m.role = 'admin') DESC, m.joined_at ASC LIMIT $2`,
    [groupId, limit]
  );
  return r.rows;
}

async function ownedCount(userId) {
  const r = await pool.query('SELECT COUNT(*)::int AS n FROM groups WHERE owner_id = $1', [userId]);
  return r.rows[0].n;
}



// ---------- PRIVATE GROUPS ----------

// SQL ka tukda: feed post (alias) is viewer ko dikhni chahiye? Private group ki post sirf members (aur site admin) ko.
const visiblePostSql = (alias, meParam, adminParam) =>
  `(${alias}.group_id IS NULL OR ${adminParam}::boolean
    OR NOT EXISTS (SELECT 1 FROM groups vg WHERE vg.id = ${alias}.group_id AND vg.is_private)
    OR EXISTS (SELECT 1 FROM group_members vm WHERE vm.group_id = ${alias}.group_id AND vm.user_id = ${meParam}))`;

// Mujhe is group ka andar ka hissa (posts, chat, members) dekhna allowed hai?
const canView = (group, role, isSiteAdmin) => !group.is_private || !!role || !!isSiteAdmin;

async function hasRequested(groupId, userId) {
  if (!userId) return false;
  const r = await pool.query('SELECT 1 FROM group_join_requests WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
  return r.rowCount > 0;
}

async function pendingRequests(groupId) {
  const r = await pool.query(
    `SELECT u.id, u.username, r.created_at FROM group_join_requests r JOIN users u ON u.id = r.user_id
     WHERE r.group_id = $1 ORDER BY r.created_at ASC LIMIT 200`,
    [groupId]
  );
  return r.rows;
}

async function pendingCount(groupId) {
  const r = await pool.query('SELECT COUNT(*)::int AS n FROM group_join_requests WHERE group_id = $1', [groupId]);
  return r.rows[0].n;
}

async function adminIds(groupId) {
  const r = await pool.query("SELECT user_id FROM group_members WHERE group_id = $1 AND role = 'admin'", [groupId]);
  return r.rows.map((x) => x.user_id);
}

// Join request bhejo (private group). Wapas: 'sent' | 'already_requested' | 'member' | 'blocked'
async function sendRequest(group, me) {
  if (await roleOf(group.id, me.id)) return 'member';
  // Group ke kisi admin ne block kiya ho to request nahi jati
  for (const aid of await adminIds(group.id)) {
    if (await Blocks.isBlockedEither(me.id, aid)) return 'blocked';
  }
  const ins = await pool.query(
    'INSERT INTO group_join_requests (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING user_id',
    [group.id, me.id]
  );
  if (!ins.rows[0]) return 'already_requested';
  for (const aid of await adminIds(group.id)) {
    notifyUser(aid, `🔒 ${me.username} wants to join ${group.name}`, `/groups/${group.slug}/manage`);
  }
  return 'sent';
}

async function cancelRequest(groupId, userId) {
  await pool.query('DELETE FROM group_join_requests WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
}

// Admin request manzoor kare ya radd kare. Wapas true agar request maujood thi
async function resolveRequest(group, userId, approve) {
  const del = await pool.query(
    'DELETE FROM group_join_requests WHERE group_id = $1 AND user_id = $2 RETURNING user_id',
    [group.id, userId]
  );
  if (!del.rows[0]) return false;
  if (approve) {
    await pool.query(
      "INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING",
      [group.id, userId]
    );
    notifyUser(userId, `✅ Your request to join ${group.name} was approved`, `/groups/${group.slug}`);
  }
  return true;
}

// Admin apne friends mein se kisi ko seedha add kare
async function addMember(group, adder, user) {
  const ins = await pool.query(
    "INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING RETURNING user_id",
    [group.id, user.id]
  );
  await pool.query('DELETE FROM group_join_requests WHERE group_id = $1 AND user_id = $2', [group.id, user.id]);
  if (ins.rows[0]) notifyUser(user.id, `👥 ${adder.username} added you to ${group.name}`, `/groups/${group.slug}`);
  return !!ins.rows[0];
}

// Mere friends jo is group mein abhi nahi hain (add karne ki list)
async function friendsToAdd(meId, groupId) {
  const r = await pool.query(
    `SELECT u.id, u.username FROM friend_requests fr
     JOIN users u ON u.id = CASE WHEN fr.sender_id = $1 THEN fr.receiver_id ELSE fr.sender_id END
     WHERE fr.status = 'accepted' AND (fr.sender_id = $1 OR fr.receiver_id = $1)
       AND NOT EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = $2 AND m.user_id = u.id)
       AND NOT ${Blocks.blockedEitherSql('$1', 'u.id')}
     ORDER BY lower(u.username) LIMIT 300`,
    [meId, groupId]
  );
  return r.rows;
}

async function allMembers(groupId) {
  const r = await pool.query(
    `SELECT u.id, u.username, m.role, m.joined_at FROM group_members m JOIN users u ON u.id = m.user_id
     WHERE m.group_id = $1 ORDER BY (m.role = 'admin') DESC, m.joined_at ASC LIMIT 500`,
    [groupId]
  );
  return r.rows;
}

// ---------- GROUP CHAT ----------
const CHAT_PAGE = 100;

async function chatThread(groupId, meId, afterId = 0, limit = CHAT_PAGE) {
  const r = await pool.query(
    `SELECT id, sender_id, body, created_at, username FROM (
       SELECT gm.id, gm.sender_id, gm.body, gm.created_at, u.username
       FROM group_messages gm JOIN users u ON u.id = gm.sender_id
       WHERE gm.group_id = $1 AND gm.id > $2 AND NOT ${Blocks.blockedEitherSql('$3', 'gm.sender_id')}
       ORDER BY gm.id DESC LIMIT $4
     ) t ORDER BY id`,
    [groupId, afterId, meId, limit]
  );
  return r.rows;
}

async function chatSend(groupId, meId, body) {
  const r = await pool.query(
    'INSERT INTO group_messages (group_id, sender_id, body) VALUES ($1, $2, $3) RETURNING id, created_at',
    [groupId, meId, body]
  );
  return r.rows[0];
}

// Message ka apna bhejne wala, group admin, ya site admin hata sakta hai
async function chatDelete(groupId, messageId, meId, isSiteAdmin) {
  const r = await pool.query(
    `DELETE FROM group_messages WHERE id = $1 AND group_id = $2 AND ($4::boolean OR sender_id = $3
       OR EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = $2 AND gm.user_id = $3 AND gm.role = 'admin'))
     RETURNING id`,
    [messageId, groupId, meId, !!isSiteAdmin]
  );
  return r.rowCount > 0;
}

module.exports = {
  NAME_MAX, NAME_MIN, DESC_MAX, MAX_OWNED,
  uniqueSlug, bySlug, byToken, roleOf, list, popular, memberPreview, ownedCount,
  visiblePostSql, canView, hasRequested, pendingRequests, pendingCount, adminIds,
  sendRequest, cancelRequest, resolveRequest, addMember, friendsToAdd, allMembers,
  chatThread, chatSend, chatDelete,
};
