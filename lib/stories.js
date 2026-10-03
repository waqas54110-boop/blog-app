// Stories: 24 ghante baad khatam hone wali photo / text. Tray (gol icons), dekhna, banana, saaf-safai.
const pool = require('../db');
const Blocks = require('./blocks');
const Images = require('./images');

const TTL_HOURS = 24;
const BG_COUNT = 6;
const BODY_MAX = 300;
const MAX_ACTIVE_PER_USER = 20;
const MAX_GROUPS = 30;

// Tray: apni + doosron ki chalti hui stories, user ke hisaab se group ho kar.
// Tarteeb: pehle apni, phir jin ki unseen stories hain (follow kiye hue pehle), phir baaqi (naye pehle).
async function tray(me) {
  const [rows, fol] = await Promise.all([
    pool.query(
      `SELECT s.id, s.user_id, s.body, s.image_id, s.bg, s.created_at, s.expires_at, u.username,
              EXISTS (SELECT 1 FROM story_views v WHERE v.story_id = s.id AND v.user_id = $1) AS seen,
              CASE WHEN s.user_id = $1
                   THEN (SELECT COUNT(*)::int FROM story_views v WHERE v.story_id = s.id) ELSE 0 END AS views
       FROM stories s JOIN users u ON u.id = s.user_id
       WHERE s.expires_at > now() AND NOT ${Blocks.blockedEitherSql('$1', 's.user_id')}
       ORDER BY s.id ASC
       LIMIT 400`,
      [me]
    ),
    pool.query('SELECT followee_id FROM follows WHERE follower_id = $1', [me]).catch(() => ({ rows: [] })),
  ]);
  const following = new Set(fol.rows.map((x) => x.followee_id));

  const byUser = new Map();
  rows.rows.forEach((s) => {
    if (!byUser.has(s.user_id)) {
      byUser.set(s.user_id, { user_id: s.user_id, username: s.username, isMe: s.user_id === me, following: following.has(s.user_id), items: [] });
    }
    byUser.get(s.user_id).items.push({
      id: s.id,
      body: s.body,
      image: s.image_id ? `/img/${s.image_id}` : null,
      bg: s.bg,
      at: s.created_at,
      seen: s.user_id === me ? true : s.seen,
      views: s.views,
    });
  });

  const groups = [...byUser.values()].map((g) => ({
    ...g,
    allSeen: g.items.every((i) => i.seen),
    last: g.items[g.items.length - 1].at,
  }));
  groups.sort((a, b) => {
    if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
    if (a.allSeen !== b.allSeen) return a.allSeen ? 1 : -1;
    if (a.following !== b.following) return a.following ? -1 : 1;
    return new Date(b.last) - new Date(a.last);
  });
  return groups.slice(0, MAX_GROUPS);
}

async function activeCount(userId) {
  const r = await pool.query('SELECT COUNT(*)::int AS n FROM stories WHERE user_id = $1 AND expires_at > now()', [userId]);
  return r.rows[0].n;
}

async function create(userId, { body, imageId, bg }) {
  const r = await pool.query(
    `INSERT INTO stories (user_id, body, image_id, bg, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5::int * interval '1 hour')) RETURNING id`,
    [userId, body, imageId, bg, TTL_HOURS]
  );
  return r.rows[0].id;
}

// Dekhne wale ko darj karo (apni story ya khatam ho chuki story ginti mein nahi)
async function markSeen(storyId, userId) {
  await pool.query(
    `INSERT INTO story_views (story_id, user_id)
     SELECT s.id, $2::int FROM stories s
     WHERE s.id = $1 AND s.user_id <> $2::int AND s.expires_at > now()
     ON CONFLICT DO NOTHING`,
    [storyId, userId]
  );
}

async function remove(storyId, userId, isAdmin) {
  const r = await pool.query(
    'DELETE FROM stories WHERE id = $1 AND ($3::boolean OR user_id = $2) RETURNING image_id, user_id',
    [storyId, userId, !!isAdmin]
  );
  if (r.rows[0]) await Images.dropIfOrphan(r.rows[0].image_id, r.rows[0].user_id);
  return r.rowCount > 0;
}

async function viewers(storyId, userId, isAdmin) {
  const r = await pool.query(
    `SELECT u.username, v.viewed_at FROM story_views v
       JOIN stories s ON s.id = v.story_id JOIN users u ON u.id = v.user_id
     WHERE v.story_id = $1 AND ($3::boolean OR s.user_id = $2)
     ORDER BY v.viewed_at DESC LIMIT 100`,
    [storyId, userId, !!isAdmin]
  );
  return r.rows;
}

// Khatam ho chuki stories (aur un ki database wali photos) hata do
async function cleanup() {
  const r = await pool.query('DELETE FROM stories WHERE expires_at < now() RETURNING image_id, user_id');
  for (const row of r.rows) {
    try { await Images.dropIfOrphan(row.image_id, row.user_id); } catch (e) { console.error('[stories cleanup] image:', e.message); }
  }
  return r.rowCount;
}

function startCleaner() {
  const run = () => cleanup().then((n) => { if (n) console.log(`[stories] ${n} purani stories hata di gayin`); })
    .catch((e) => console.error('[stories cleanup] (migration_v20.sql chali?):', e.message));
  setTimeout(run, 60 * 1000);
  setInterval(run, 30 * 60 * 1000).unref();
}

module.exports = { TTL_HOURS, BG_COUNT, BODY_MAX, MAX_ACTIVE_PER_USER, tray, activeCount, create, markSeen, remove, viewers, cleanup, startCleaner };
