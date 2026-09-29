// Har minute dekhta hai: jo post ab live ho chuki (chahe abhi publish ki ya schedule thi),
// use IndexNow par bhejta hai aur push notification deta hai. Har kaam har post ke liye sirf ek baar.
const pool = require('../db');
const config = require('../config');
const indexnow = require('./indexnow');
const push = require('./push');
const card = require('./card');

let running = false;

const plain = (post) =>
  (post.excerpt || post.content.replace(/<[^>]*>/g, ' ').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*_`>~]/g, '').replace(/\s+/g, ' ').trim())
    .slice(0, 140);

async function processPublished() {
  if (running) return;
  running = true;
  try {
    const pending = await pool.query(
      `SELECT id FROM posts
       WHERE is_draft = false AND publish_at <= now() AND publish_at > now() - interval '2 days'
         AND (indexnow_sent = false OR push_sent = false)
       ORDER BY publish_at ASC`
    );

    for (const { id } of pending.rows) {
      // ---- IndexNow ----
      if (indexnow.isPublicSite()) {
        const c = await pool.query('UPDATE posts SET indexnow_sent = true WHERE id = $1 AND indexnow_sent = false RETURNING slug', [id]);
        if (c.rows[0]) {
          const url = `${config.siteUrl}/posts/${c.rows[0].slug}`;
          const r = await indexnow.ping([url, config.siteUrl + '/']);
          console.log(`[indexnow] post ${id}: ${r.ok ? 'bhej di' : 'nahi gayi'} (${r.status})`);
          if (!r.ok && r.retry) await pool.query('UPDATE posts SET indexnow_sent = false WHERE id = $1', [id]); // baad mein dobara
        }
      }

      // ---- Push ----
      if (push.isAvailable() && config.siteUrl && (await push.init())) {
        const c = await pool.query(
          `UPDATE posts SET push_sent = true WHERE id = $1 AND push_sent = false
           RETURNING slug, title, excerpt, content, category`,
          [id]
        );
        const post = c.rows[0];
        if (post) {
          const r = await push.sendToAll({
            title: post.title,
            body: plain(post),
            url: `/posts/${post.slug}?utm_source=push&utm_medium=notification`,
            tag: 'post-' + id,
            icon: card.isAvailable() ? '/icons/192.png' : undefined,
          });
          console.log(`[push] post ${id}: ${r.sent} notifications gayi, ${r.failed} fail`);
        }
      }
    }
  } catch (err) {
    console.error('[publisher] error:', err.message);
  } finally {
    running = false;
  }
}

function startPublisher() {
  if (!config.siteUrl) console.log('[publisher] SITE_URL set nahi hai, IndexNow aur push band hain.');
  else if (indexnow.isPublicSite()) console.log(`[indexnow] key file: ${config.siteUrl}/${indexnow.KEY}.txt`);
  setTimeout(processPublished, 15 * 1000);
  setInterval(processPublished, 60 * 1000);
}

module.exports = { startPublisher, processPublished };
