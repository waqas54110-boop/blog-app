// Groups: har group ka apna naam, members aur apni feed (feed_posts jin par group_id laga ho).
const pool = require('../db');
const { slugify } = require('./slug');

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
    `SELECT g.id, g.slug, g.name, g.description, g.emoji, g.owner_id,
            (SELECT COUNT(*)::int FROM group_members m WHERE m.group_id = g.id) AS members,
            (SELECT COUNT(*)::int FROM feed_posts f WHERE f.group_id = g.id AND NOT f.is_hidden) AS posts,
            EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = $1) AS joined
     FROM groups g ${where}
     ORDER BY joined DESC, members DESC, g.id ASC
     LIMIT ${Math.max(1, Math.min(100, limit))}`,
    params
  );
  return r.rows;
}

async function popular(limit = 5, me = 0) {
  const r = await pool.query(
    `SELECT g.slug, g.name, g.emoji,
            (SELECT COUNT(*)::int FROM group_members m WHERE m.group_id = g.id) AS members,
            EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = $2) AS joined
     FROM groups g ORDER BY members DESC, g.id ASC LIMIT $1`,
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

module.exports = { NAME_MAX, NAME_MIN, DESC_MAX, MAX_OWNED, uniqueSlug, bySlug, byToken, roleOf, list, popular, memberPreview, ownedCount };
