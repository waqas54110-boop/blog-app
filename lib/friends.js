// Friend request logic: bhejo / accept / decline (ya cancel) / unfriend.
// Accept hone par DONO users ek doosre ko follow karne lagte hain (follows table), phir naya post/contest ki notification wahi purana follow system bhejta hai.
const pool = require('../db');
const { notifyUser } = require('./notify');
const Blocks = require('./blocks');

const profileLink = (username) => `/u/${encodeURIComponent(username)}`;

// me aur other ke darmiyan kya hai: 'none' | 'sent' (maine bheji) | 'received' (usne bheji) | 'friends'
async function stateBetween(meId, otherId) {
  const r = await pool.query(
    `SELECT sender_id, status FROM friend_requests
     WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)`,
    [meId, otherId]
  );
  const row = r.rows[0];
  if (!row) return 'none';
  if (row.status === 'accepted') return 'friends';
  return row.sender_id === meId ? 'sent' : 'received';
}

async function makeMutualFollow(a, b, client = pool) {
  await client.query(
    `INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING`,
    [a, b]
  );
}

// Request bhejo. Agar samne wale ki request pehle se aayi hui hai to seedha accept ho jati hai.
async function sendRequest(me, target) {
  if (await Blocks.isBlockedEither(me.id, target.id)) return 'blocked'; // block ho to request nahi jati
  const st = await stateBetween(me.id, target.id);
  if (st === 'friends' || st === 'sent') return st;
  if (st === 'received') return acceptRequest(me, target);
  const ins = await pool.query(
    `INSERT INTO friend_requests (sender_id, receiver_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING sender_id`,
    [me.id, target.id]
  );
  if (ins.rows[0]) {
    notifyUser(target.id, `👋 ${me.username} sent you a friend request`, '/friends?tab=requests');
  }
  return 'sent';
}

// Accept: sirf wahi kar sakta hai jise request aayi thi
async function acceptRequest(me, sender) {
  const client = await pool.connect();
  let ok = false;
  try {
    await client.query('BEGIN');
    const u = await client.query(
      `UPDATE friend_requests SET status = 'accepted', responded_at = now()
       WHERE sender_id = $1 AND receiver_id = $2 AND status = 'pending' RETURNING sender_id`,
      [sender.id, me.id]
    );
    if (u.rows[0]) {
      await makeMutualFollow(me.id, sender.id, client);
      ok = true;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  if (ok) notifyUser(sender.id, `✅ ${me.username} accepted your friend request. You now follow each other.`, profileLink(me.username));
  return ok ? 'friends' : await stateBetween(me.id, sender.id);
}

// Decline (jise aayi thi) ya Cancel (jis ne bheji thi): pending row hata do. Notification nahi jati.
async function removePending(me, other) {
  await pool.query(
    `DELETE FROM friend_requests WHERE status = 'pending'
     AND ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))`,
    [me.id, other.id]
  );
}

// Unfriend: dosti khatam + dono taraf ka follow bhi khatam
async function unfriend(me, other) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const d = await client.query(
      `DELETE FROM friend_requests WHERE status = 'accepted'
       AND ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)) RETURNING sender_id`,
      [me.id, other.id]
    );
    if (d.rows[0]) {
      await client.query(
        `DELETE FROM follows WHERE (follower_id = $1 AND followee_id = $2) OR (follower_id = $2 AND followee_id = $1)`,
        [me.id, other.id]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function pendingCount(userId) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c FROM friend_requests WHERE receiver_id = $1 AND status = 'pending'`,
    [userId]
  );
  return r.rows[0].c;
}

const likeEscape = (s) => s.replace(/[\\%_]/g, (m) => '\\' + m);

// SQL ka tukda: me aur other ke mutual friends (dono ke accepted friends ka common hissa) ginne ke liye.
// Block hone par dosti pehle hi khatam ho jati hai, is liye blocked log kabhi mutual mein nahi aate.
const friendIdsSql = (who) =>
  `SELECT CASE WHEN fr.sender_id = ${who} THEN fr.receiver_id ELSE fr.sender_id END AS fid
   FROM friend_requests fr WHERE fr.status = 'accepted' AND (fr.sender_id = ${who} OR fr.receiver_id = ${who})`;
const mutualCountSql = (me, other) =>
  `(SELECT COUNT(*)::int FROM (${friendIdsSql(me)}) a JOIN (${friendIdsSql(other)}) b ON a.fid = b.fid)`;

// Teeno tabs ka data. Jin ke saath mutual friends hain wo upar aate hain (zyada mutual = pehle).
async function people(meId, q) {
  const term = likeEscape(String(q || '').trim().slice(0, 50));
  const r = await pool.query(
    `SELECT u.id, u.username, u.created_at,
            CASE WHEN fr.sender_id IS NULL THEN 'none'
                 WHEN fr.status = 'accepted' THEN 'friends'
                 WHEN fr.sender_id = $1 THEN 'sent'
                 ELSE 'received' END AS state,
            ${mutualCountSql('$1', 'u.id')} AS mutual
     FROM users u
     LEFT JOIN friend_requests fr
       ON (fr.sender_id = $1 AND fr.receiver_id = u.id) OR (fr.sender_id = u.id AND fr.receiver_id = $1)
     WHERE u.id <> $1 AND ($2 = '' OR u.username ILIKE '%' || $2 || '%')
       AND NOT ${Blocks.blockedEitherSql('$1', 'u.id')}
     ORDER BY mutual DESC, u.created_at DESC, u.id DESC LIMIT 60`,
    [meId, term]
  );
  return r.rows;
}

// "People you may know": doston ke dost. Jin se pehle koi bhi request (pending ya accepted) hai, ya block hai, wo nahi aate.
async function suggestions(meId, limit = 8) {
  const r = await pool.query(
    `WITH my_friends AS (${friendIdsSql('$1')}),
     edges AS (
       SELECT CASE WHEN fr.sender_id = mf.fid THEN fr.receiver_id ELSE fr.sender_id END AS cand
       FROM my_friends mf
       JOIN friend_requests fr ON fr.status = 'accepted' AND (fr.sender_id = mf.fid OR fr.receiver_id = mf.fid)
     )
     SELECT u.id, u.username, u.created_at, COUNT(*)::int AS mutual
     FROM edges e JOIN users u ON u.id = e.cand
     WHERE u.id <> $1
       AND NOT EXISTS (
         SELECT 1 FROM friend_requests x
         WHERE (x.sender_id = $1 AND x.receiver_id = u.id) OR (x.sender_id = u.id AND x.receiver_id = $1))
       AND NOT ${Blocks.blockedEitherSql('$1', 'u.id')}
     GROUP BY u.id, u.username, u.created_at
     ORDER BY mutual DESC, u.created_at DESC, u.id DESC
     LIMIT $2`,
    [meId, Math.max(1, Math.min(20, limit | 0))]
  );
  return r.rows;
}

// Profile ke liye: "3 mutual friends" aur pehle chand naam
async function mutualFriends(meId, otherId, limit = 3) {
  const r = await pool.query(
    `WITH mine AS (${friendIdsSql('$1')}), theirs AS (${friendIdsSql('$2')})
     SELECT u.id, u.username, COUNT(*) OVER ()::int AS total
     FROM mine JOIN theirs ON mine.fid = theirs.fid JOIN users u ON u.id = mine.fid
     ORDER BY lower(u.username) LIMIT $3`,
    [meId, otherId, Math.max(1, Math.min(10, limit | 0))]
  );
  return { count: r.rows[0] ? r.rows[0].total : 0, list: r.rows.map((x) => ({ id: x.id, username: x.username })) };
}

async function incoming(meId) {
  const r = await pool.query(
    `SELECT u.id, u.username, fr.created_at, ${mutualCountSql('$1', 'u.id')} AS mutual
     FROM friend_requests fr JOIN users u ON u.id = fr.sender_id
     WHERE fr.receiver_id = $1 AND fr.status = 'pending' ORDER BY fr.created_at DESC LIMIT 100`,
    [meId]
  );
  return r.rows;
}

async function outgoing(meId) {
  const r = await pool.query(
    `SELECT u.id, u.username, fr.created_at FROM friend_requests fr JOIN users u ON u.id = fr.receiver_id
     WHERE fr.sender_id = $1 AND fr.status = 'pending' ORDER BY fr.created_at DESC LIMIT 100`,
    [meId]
  );
  return r.rows;
}

async function friendList(meId) {
  const r = await pool.query(
    `SELECT u.id, u.username, fr.responded_at AS since
     FROM friend_requests fr
     JOIN users u ON u.id = CASE WHEN fr.sender_id = $1 THEN fr.receiver_id ELSE fr.sender_id END
     WHERE fr.status = 'accepted' AND (fr.sender_id = $1 OR fr.receiver_id = $1)
     ORDER BY lower(u.username) LIMIT 500`,
    [meId]
  );
  return r.rows;
}

module.exports = {
  stateBetween, sendRequest, acceptRequest, removePending, unfriend, pendingCount,
  people, suggestions, mutualFriends, incoming, outgoing, friendList,
};
