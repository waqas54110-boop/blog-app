// Report / moderation queue ka saara logic (routes aur comment handlers yahin se kaam lete hain).
const pool = require('../db');

const REASONS = ['spam', 'abuse', 'hate', 'misleading', 'other'];
const TYPES = ['comment', 'poll_comment', 'poll', 'user', 'message', 'feed_post', 'feed_comment', 'petition', 'court_case'];
// Jin types ka content "hidden" ho sakta hai, unki table (auto-hide, keep, delete mein kaam aata hai)
const HIDEABLE = { comment: 'comments', poll_comment: 'poll_comments', feed_post: 'feed_posts', feed_comment: 'feed_comments', petition: 'petitions', court_case: 'court_cases' };
// Itne alag logon ki report par comment khud "hidden" ho jata hai, jab tak admin dekh na le
const AUTOHIDE = Math.min(Math.max(parseInt(process.env.REPORT_AUTOHIDE, 10) || 3, 2), 20);

// Sirf wo reports jin ka content abhi maujood hai (delete ho chuke content ki reports queue mein nahi aati)
const TARGET_EXISTS = `(
  (r.target_type = 'comment'      AND EXISTS (SELECT 1 FROM comments t      WHERE t.id = r.target_id)) OR
  (r.target_type = 'poll_comment' AND EXISTS (SELECT 1 FROM poll_comments t WHERE t.id = r.target_id)) OR
  (r.target_type = 'poll'         AND EXISTS (SELECT 1 FROM polls t         WHERE t.id = r.target_id)) OR
  (r.target_type = 'user'         AND EXISTS (SELECT 1 FROM users t         WHERE t.id = r.target_id)) OR
  (r.target_type = 'message'      AND EXISTS (SELECT 1 FROM messages t      WHERE t.id = r.target_id)) OR
  (r.target_type = 'feed_post'    AND EXISTS (SELECT 1 FROM feed_posts t    WHERE t.id = r.target_id)) OR
  (r.target_type = 'feed_comment' AND EXISTS (SELECT 1 FROM feed_comments t WHERE t.id = r.target_id)) OR
  (r.target_type = 'petition'     AND EXISTS (SELECT 1 FROM petitions t     WHERE t.id = r.target_id)) OR
  (r.target_type = 'court_case'   AND EXISTS (SELECT 1 FROM court_cases t   WHERE t.id = r.target_id))
)`;

// Admin ke nav badge ke liye
async function openCount() {
  const r = await pool.query(
    `SELECT COUNT(DISTINCT (r.target_type, r.target_id))::int AS c FROM reports r WHERE r.status = 'open' AND ${TARGET_EXISTS}`
  );
  return r.rows[0].c;
}

// Spam filter ne comment rok liya: hidden save + queue mein entry (reporter_id NULL = system)
async function holdForReview(type, targetId, why) {
  await pool.query(
    "INSERT INTO reports (reporter_id, target_type, target_id, reason, details) VALUES (NULL, $1, $2, 'spam', $3)",
    [type, targetId, ('Spam filter: ' + why).slice(0, 300)]
  );
}

// Queue: har content ek baar (kitni reports, kis wajah se, kis ne ki)
async function openGroups() {
  const g = await pool.query(
    `SELECT r.target_type, r.target_id, COUNT(*)::int AS n,
            COALESCE(string_agg(DISTINCT u.username, ', ') FILTER (WHERE u.username IS NOT NULL), '') AS reporters,
            array_agg(DISTINCT r.reason) AS reasons,
            bool_or(r.reporter_id IS NULL) AS auto,
            (array_agg(r.details ORDER BY r.created_at) FILTER (WHERE r.details IS NOT NULL))[1:3] AS notes,
            MIN(r.created_at) AS first_at, MAX(r.created_at) AS last_at
     FROM reports r LEFT JOIN users u ON u.id = r.reporter_id
     WHERE r.status = 'open' AND ${TARGET_EXISTS}
     GROUP BY r.target_type, r.target_id
     ORDER BY COUNT(*) DESC, MAX(r.created_at) DESC
     LIMIT 100`
  );
  const ids = (t) => g.rows.filter((x) => x.target_type === t).map((x) => x.target_id);
  const [cm, pc, pl, us, ms, fp, fc, pt, cc] = await Promise.all([
    pool.query(
      `SELECT c.id, c.body, c.is_hidden, c.created_at, c.user_id, u.username, p.slug, p.title
       FROM comments c JOIN users u ON u.id = c.user_id JOIN posts p ON p.id = c.post_id WHERE c.id = ANY($1::int[])`, [ids('comment')]),
    pool.query(
      `SELECT c.id, c.body, c.is_hidden, c.created_at, c.user_id, u.username, c.poll_id, p.title
       FROM poll_comments c JOIN users u ON u.id = c.user_id JOIN polls p ON p.id = c.poll_id WHERE c.id = ANY($1::int[])`, [ids('poll_comment')]),
    pool.query('SELECT id, title, is_closed FROM polls WHERE id = ANY($1::int[])', [ids('poll')]),
    pool.query('SELECT id, username, created_at FROM users WHERE id = ANY($1::int[])', [ids('user')]),
    // Private message: admin ko sirf wahi ek reported message dikhta hai (poori chat nahi)
    pool.query(
      `SELECT m.id, m.body, m.created_at, m.sender_id AS user_id, s.username, m.media_id, mm.kind AS media_kind
       FROM messages m JOIN users s ON s.id = m.sender_id LEFT JOIN message_media mm ON mm.id = m.media_id
       WHERE m.id = ANY($1::int[])`, [ids('message')]),
    pool.query(
      `SELECT f.id, f.body, f.image_id, f.is_hidden, f.created_at, f.user_id, u.username, 'a feed post'::text AS title
       FROM feed_posts f JOIN users u ON u.id = f.user_id WHERE f.id = ANY($1::int[])`, [ids('feed_post')]),
    pool.query(
      `SELECT c.id, c.body, c.is_hidden, c.created_at, c.user_id, c.post_id, u.username, 'a feed post'::text AS title
       FROM feed_comments c JOIN users u ON u.id = c.user_id WHERE c.id = ANY($1::int[])`, [ids('feed_comment')]),
    pool.query(
      `SELECT p.id, p.title, p.body, p.is_hidden, p.created_at, p.user_id, u.username
       FROM petitions p JOIN users u ON u.id = p.user_id WHERE p.id = ANY($1::int[])`, [ids('petition')]),
    // Court case: admin ko background aur dono wakeelon ki dalail dikhti hain
    pool.query(
      `SELECT c.id, c.title, c.is_hidden, c.created_at, c.created_by AS user_id, COALESCE(u.username, 'admin') AS username,
              c.summary || COALESCE((SELECT chr(10) || chr(10) || string_agg(lu.username || ' (side ' || l.side || '): ' || l.opening, chr(10) || chr(10) ORDER BY l.side)
                 FROM court_lawyers l JOIN users lu ON lu.id = l.user_id WHERE l.case_id = c.id), '') AS body
       FROM court_cases c LEFT JOIN users u ON u.id = c.created_by WHERE c.id = ANY($1::int[])`, [ids('court_case')]),
  ]);
  const byType = { comment: new Map(cm.rows.map((x) => [x.id, x])), poll_comment: new Map(pc.rows.map((x) => [x.id, x])), poll: new Map(pl.rows.map((x) => [x.id, x])), user: new Map(us.rows.map((x) => [x.id, x])), message: new Map(ms.rows.map((x) => [x.id, x])), feed_post: new Map(fp.rows.map((x) => [x.id, x])), feed_comment: new Map(fc.rows.map((x) => [x.id, x])), petition: new Map(pt.rows.map((x) => [x.id, x])), court_case: new Map(cc.rows.map((x) => [x.id, x])) };
  return g.rows
    .map((x) => {
      const t = byType[x.target_type].get(x.target_id);
      if (!t) return null;
      const link = x.target_type === 'user' || x.target_type === 'message' ? `/u/${encodeURIComponent(t.username)}`
        : x.target_type === 'comment' ? `/posts/${t.slug}#c${t.id}`
        : x.target_type === 'poll_comment' ? `/votes/${t.poll_id}#c${t.id}`
        : x.target_type === 'feed_post' ? `/feed/${t.id}`
        : x.target_type === 'feed_comment' ? `/feed/${t.post_id}#c${t.id}`
        : x.target_type === 'petition' ? `/petitions/${t.id}`
        : x.target_type === 'court_case' ? `/court/${t.id}`
        : `/votes/${t.id}`;
      return { ...x, target: t, link };
    })
    .filter(Boolean);
}

async function recentHandled(limit = 15) {
  const r = await pool.query(
    `SELECT r.id, r.target_type, r.target_id, r.reason, r.status, r.action, r.handled_at, a.username AS admin
     FROM reports r LEFT JOIN users a ON a.id = r.handled_by
     WHERE r.status <> 'open' ORDER BY r.handled_at DESC NULLS LAST, r.id DESC LIMIT $1`,
    [limit]
  );
  return r.rows;
}

// Is content ki saari open reports band karo
async function resolve(type, id, status, action, adminId) {
  await pool.query(
    `UPDATE reports SET status = $3, action = $4, handled_by = $5, handled_at = now()
     WHERE target_type = $1 AND target_id = $2 AND status = 'open'`,
    [type, id, status, action, adminId]
  );
}

module.exports = { REASONS, TYPES, HIDEABLE, AUTOHIDE, openCount, holdForReview, openGroups, recentHandled, resolve };
