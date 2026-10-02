// Block user: blocked user request / message / follow nahi bhej sakta, aur dosti + follow dono taraf se khatam.
const pool = require('../db');

// SQL ka tukda: u.id aur $N (me) ke darmiyan koi bhi taraf se block hai?
const blockedEitherSql = (meParam, otherExpr) =>
  `EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ${meParam} AND b.blocked_id = ${otherExpr}) OR (b.blocker_id = ${otherExpr} AND b.blocked_id = ${meParam}))`;

async function isBlockedEither(a, b) {
  const r = await pool.query(
    `SELECT 1 FROM user_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) LIMIT 1`,
    [a, b]
  );
  return r.rowCount > 0;
}

// 'none' | 'by_me' (maine block kiya) | 'me' (usne mujhe block kiya)
async function stateFor(meId, otherId) {
  const r = await pool.query(
    `SELECT blocker_id FROM user_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`,
    [meId, otherId]
  );
  if (!r.rows.length) return 'none';
  return r.rows.some((x) => x.blocker_id === meId) ? 'by_me' : 'me';
}

async function block(meId, otherId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [meId, otherId]
    );
    await client.query(
      `DELETE FROM friend_requests WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)`,
      [meId, otherId]
    );
    await client.query(
      `DELETE FROM follows WHERE (follower_id = $1 AND followee_id = $2) OR (follower_id = $2 AND followee_id = $1)`,
      [meId, otherId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function unblock(meId, otherId) {
  await pool.query('DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2', [meId, otherId]);
}

async function blockedList(meId) {
  const r = await pool.query(
    `SELECT u.id, u.username, b.created_at FROM user_blocks b JOIN users u ON u.id = b.blocked_id
     WHERE b.blocker_id = $1 ORDER BY b.created_at DESC LIMIT 200`,
    [meId]
  );
  return r.rows;
}

module.exports = { blockedEitherSql, isBlockedEither, stateFor, block, unblock, blockedList };
