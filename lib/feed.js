// Community Feed: posts, comments, aur "kitni der pehle" helper.
const pool = require('../db');
const Blocks = require('./blocks');
const Groups = require('./groups');

const PAGE = 10;

function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h';
  const days = Math.floor(h / 24);
  if (days < 7) return days + 'd';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// opts: me (user id ya null), isAdmin, tab ('all' | 'following' | 'groups'), authorId, groupId, before (post id), onlyId, limit
// Aam feed (home, profile) mein group ki posts nahi aatin. Group ki posts sirf group page, "groups" tab aur single post page par.
// Wapas: { posts, hasMore }
async function list(opts) {
  const { me, isAdmin, tab, authorId, groupId, before, onlyId } = opts;
  const limit = Math.max(1, Math.min(30, opts.limit || PAGE));
  const params = [];
  const p = (v) => { params.push(v); return '$' + params.length; };
  const meP = p(me || 0);
  const adminP = p(!!isAdmin);

  // Chhupi hui (hidden) post sirf apne owner aur admin ko dikhti hai
  const where = [`(NOT f.is_hidden OR f.user_id = ${meP} OR ${adminP}::boolean)`];
  if (me) where.push(`NOT ${Blocks.blockedEitherSql(meP, 'f.user_id')}`);
  // Private group ki post sirf us group ke members (aur site admin) ko
  where.push(Groups.visiblePostSql('f', meP, adminP));
  if (tab === 'following' && me) {
    where.push(`(f.user_id = ${meP} OR EXISTS (SELECT 1 FROM follows fl WHERE fl.follower_id = ${meP} AND fl.followee_id = f.user_id))`);
  }
  if (groupId) where.push(`f.group_id = ${p(groupId)}`);
  else if (tab === 'groups' && me) where.push(`f.group_id IN (SELECT gm.group_id FROM group_members gm WHERE gm.user_id = ${meP})`);
  else if (!onlyId) where.push('f.group_id IS NULL');
  if (authorId) where.push(`f.user_id = ${p(authorId)}`);
  if (before) where.push(`f.id < ${p(before)}`);
  if (onlyId) where.push(`f.id = ${p(onlyId)}`);

  const r = await pool.query(
    `SELECT f.id, f.user_id, f.body, f.image_id, f.is_hidden, f.created_at, f.views, f.group_id, g.slug AS group_slug, g.name AS group_name, g.emoji AS group_emoji, u.username, u.role,
            (SELECT COUNT(*)::int FROM feed_likes l WHERE l.post_id = f.id) AS likes,
            (SELECT COUNT(*)::int FROM feed_comments c WHERE c.post_id = f.id AND NOT c.is_hidden) AS comments,
            EXISTS (SELECT 1 FROM feed_likes l WHERE l.post_id = f.id AND l.user_id = ${meP}) AS liked
     FROM feed_posts f JOIN users u ON u.id = f.user_id LEFT JOIN groups g ON g.id = f.group_id
     WHERE ${where.join(' AND ')}
     ORDER BY f.id DESC
     LIMIT ${limit + 1}`,
    params
  );
  const hasMore = r.rows.length > limit;
  return { posts: r.rows.slice(0, limit), hasMore };
}

// Har post ke comments. all=false: sirf aakhri 2 (feed page), all=true: sab (post page, max 300)
async function commentsFor(postIds, { me, isAdmin, all }) {
  const map = new Map(postIds.map((id) => [id, []]));
  if (!postIds.length) return map;
  const params = [postIds, me || 0, !!isAdmin];
  const blockSql = me ? `AND NOT ${Blocks.blockedEitherSql('$2', 'c.user_id')}` : '';
  const r = await pool.query(
    `SELECT * FROM (
       SELECT c.id, c.post_id, c.user_id, c.body, c.is_hidden, c.created_at, u.username,
              ROW_NUMBER() OVER (PARTITION BY c.post_id ORDER BY c.id DESC) AS rn
       FROM feed_comments c JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ANY($1::int[]) AND (NOT c.is_hidden OR c.user_id = $2 OR $3::boolean) ${blockSql}
     ) t
     WHERE ${all ? 't.rn <= 300' : 't.rn <= 2'}
     ORDER BY t.id`,
    params
  );
  r.rows.forEach((c) => map.get(c.post_id).push(c));
  return map;
}

async function attach(posts, ctx, all) {
  const cm = await commentsFor(posts.map((x) => x.id), { ...ctx, all });
  posts.forEach((x) => { x.recent = cm.get(x.id) || []; });
  return posts;
}

module.exports = { PAGE, timeAgo, list, commentsFor, attach };
