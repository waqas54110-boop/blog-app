// Follow: jab koi user naya post ya naya contest banaye to us ke followers ko in-app notification (aur email, agar unhon ne rakhi ho).
// Har minute dekhta hai kaun si post/contest abhi tak followers ko nahi gayi; har ek sirf ek baar jati hai.
const pool = require('../db');
const config = require('../config');
const { notifyUser } = require('./notify');

let running = false;

const profileLink = (username) => `/u/${encodeURIComponent(username)}`;

// Sirf verified email wale followers ko email jati hai (warna kisi aur ki email par spam ja sakta hai)
async function notifyFollowers(authorId, authorName, message, link, subject) {
  const r = await pool.query(
    `SELECT f.follower_id, f.notify_email, u.email_verified
     FROM follows f JOIN users u ON u.id = f.follower_id
     WHERE f.followee_id = $1 ORDER BY f.created_at`,
    [authorId]
  );
  const base = config.siteUrl || '';
  const footer = `You get this because you follow ${authorName}. Turn off email alerts here: ${base}${profileLink(authorName)}`;
  // Ek ek karke: email provider ki rate limit se bachne ke liye
  for (const f of r.rows) {
    await notifyUser(f.follower_id, message, link, {
      email: f.notify_email && f.email_verified, emailSubject: subject, footer,
    });
  }
  return r.rowCount;
}

const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

async function tick() {
  if (running) return;
  running = true;
  try {
    // ---- naye posts (draft ya schedule ki hui post jab live ho jaye tab) ----
    const posts = await pool.query(
      `SELECT id FROM posts WHERE followers_sent = false AND is_draft = false AND publish_at <= now() ORDER BY publish_at LIMIT 20`
    );
    for (const { id } of posts.rows) {
      const c = await pool.query(
        `UPDATE posts p SET followers_sent = true
         FROM users u WHERE p.id = $1 AND p.followers_sent = false AND u.id = p.user_id
         RETURNING p.slug, p.title, p.user_id, u.username`,
        [id]
      );
      const p = c.rows[0];
      if (!p) continue;
      try {
        const n = await notifyFollowers(
          p.user_id, p.username,
          `📝 ${p.username} published a new post: "${cut(p.title, 150)}"`,
          `/posts/${p.slug}?utm_source=follow&utm_medium=notification`,
          `New post from ${p.username}: ${cut(p.title, 120)}`
        );
        if (n) console.log(`[follow] post ${id}: ${n} followers ko notification gayi`);
      } catch (err) {
        console.error(`[follow] post ${id}:`, err.message);
      }
    }

    // ---- naye contests ----
    const polls = await pool.query(`SELECT id FROM polls WHERE followers_sent = false ORDER BY id LIMIT 20`);
    for (const { id } of polls.rows) {
      const c = await pool.query(
        `UPDATE polls p SET followers_sent = true
         FROM users u WHERE p.id = $1 AND p.followers_sent = false AND u.id = p.created_by
         RETURNING p.title, p.created_by, u.username`,
        [id]
      );
      const p = c.rows[0];
      if (!p) { // banane wala user nahi raha: bas mark kar do
        await pool.query('UPDATE polls SET followers_sent = true WHERE id = $1', [id]);
        continue;
      }
      try {
        const n = await notifyFollowers(
          p.created_by, p.username,
          `🗳️ ${p.username} started a new contest: "${cut(p.title, 150)}"`,
          `/votes/${id}?utm_source=follow&utm_medium=notification`,
          `New contest from ${p.username}: ${cut(p.title, 120)}`
        );
        if (n) console.log(`[follow] contest ${id}: ${n} followers ko notification gayi`);
      } catch (err) {
        console.error(`[follow] contest ${id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[follow] tick (migration_v13.sql chali?):', err.message);
  } finally {
    running = false;
  }
}

function startFollowNotifier() {
  setTimeout(tick, 25 * 1000);
  setInterval(tick, 60 * 1000);
}

module.exports = { startFollowNotifier, tick, profileLink };
