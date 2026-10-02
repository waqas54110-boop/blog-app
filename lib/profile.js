// Public profile ka data: stats, rank, badges, votes, predictions, followers.
const pool = require('../db');
const badges = require('./badges');
const R = require('./referral');

// Prediction League rank (leaderboard jaisi tarteeb: points, phir sahi predictions)
async function predictionRank(userId) {
  const r = await pool.query(
    `WITH t AS (
       SELECT p.user_id, SUM(p.points)::int AS pts,
              COUNT(*) FILTER (WHERE p.points > 0)::int AS correct, COUNT(*)::int AS played
       FROM predictions p JOIN pred_matches m ON m.id = p.match_id AND m.winner IS NOT NULL
       GROUP BY p.user_id
     ), ranked AS (
       SELECT user_id, pts, correct, played,
              RANK() OVER (ORDER BY pts DESC, correct DESC) AS rank,
              COUNT(*) OVER () AS total
       FROM t
     )
     SELECT pts, correct, played, rank::int AS rank, total::int AS total FROM ranked WHERE user_id = $1`,
    [userId]
  );
  return r.rows[0] || { pts: 0, correct: 0, played: 0, rank: null, total: 0 };
}

async function load(profile, viewerId) {
  const id = profile.id;
  const [pred, counts, votes, preds, follow, authored] = await Promise.all([
    predictionRank(id),
    pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM poll_votes WHERE user_id = $1)
           + (SELECT COUNT(*)::int FROM poll_match_votes WHERE user_id = $1) AS votes,
         (SELECT COUNT(*)::int FROM comments WHERE user_id = $1 AND NOT is_hidden)
           + (SELECT COUNT(*)::int FROM poll_comments WHERE user_id = $1 AND NOT is_hidden) AS comments,
         (SELECT COUNT(*)::int FROM polls WHERE giveaway_user_id = $1) AS giveaway_wins,
         (SELECT COUNT(*)::int FROM follows WHERE followee_id = $1) AS followers,
         (SELECT COUNT(*)::int FROM follows WHERE follower_id = $1) AS following`,
      [id]
    ),
    pool.query(
      `SELECT * FROM (
         SELECT p.id AS poll_id, p.title, o.name AS option_name, v.created_at
         FROM poll_votes v JOIN polls p ON p.id = v.poll_id JOIN poll_options o ON o.id = v.option_id
         WHERE v.user_id = $1
         UNION ALL
         SELECT p.id, p.title, o.name, v.created_at
         FROM poll_match_votes v JOIN polls p ON p.id = v.poll_id JOIN poll_options o ON o.id = v.option_id
         WHERE v.user_id = $1
       ) x ORDER BY created_at DESC LIMIT 10`,
      [id]
    ),
    // Jis match par abhi predictions khuli hain, wahan pick nahi dikhate (warna doosre copy kar lein)
    pool.query(
      `SELECT m.team_a, m.team_b, m.title, m.winner, pr.pick, pr.points
       FROM predictions pr JOIN pred_matches m ON m.id = pr.match_id
       WHERE pr.user_id = $1 AND (m.winner IS NOT NULL OR m.starts_at <= now())
       ORDER BY m.starts_at DESC LIMIT 10`,
      [id]
    ),
    viewerId
      ? pool.query('SELECT notify_email FROM follows WHERE follower_id = $1 AND followee_id = $2', [viewerId, id])
      : Promise.resolve({ rows: [] }),
    Promise.all([
      pool.query(
        `SELECT p.slug, p.title, p.publish_at FROM posts p
         WHERE p.user_id = $1 AND p.is_draft = false AND p.publish_at <= now()
         ORDER BY p.publish_at DESC LIMIT 5`, [id]),
      pool.query('SELECT p.id, p.title, p.created_at FROM polls p WHERE p.created_by = $1 ORDER BY p.created_at DESC LIMIT 5', [id]),
    ]),
  ]);

  const c = counts.rows[0];
  const ref = await R.statsFor(id);
  const stats = {
    votes: c.votes, comments: c.comments, followers: c.followers, following: c.following,
    pts: pred.pts, played: pred.played, correct: pred.correct, rank: pred.rank, ranked: pred.total,
    referrals: ref.qualified,
  };
  return {
    stats,
    badges: badges.compute({
      role: profile.role, votes: c.votes, comments: c.comments, played: pred.played, correct: pred.correct,
      rank: pred.rank, ranked: pred.total, giveawayWins: c.giveaway_wins, referrals: ref.qualified,
    }),
    votes: votes.rows,
    predictions: preds.rows,
    isFollowing: !!follow.rows[0],
    notifyEmail: follow.rows[0] ? follow.rows[0].notify_email : false,
    posts: authored[0].rows,
    polls: authored[1].rows,
  };
}

module.exports = { load };
