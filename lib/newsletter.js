const pool = require('../db');
const config = require('../config');
const { sendMail, mailConfigured } = require('./mailer');
const { esc } = require('./notify');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function plainPreview(post) {
  if (post.excerpt) return post.excerpt;
  return post.content.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*_`>~]/g, '').slice(0, 200) + '...';
}

async function sendPostToSubscribers(post) {
  const subs = await pool.query('SELECT email, unsubscribe_token FROM subscribers');
  const postUrl = `${config.siteUrl}/posts/${post.id}?utm_source=newsletter&utm_medium=email`;
  let sent = 0;

  for (const s of subs.rows) {
    const unsub = `${config.siteUrl}/unsubscribe/${s.unsubscribe_token}`;
    const preview = plainPreview(post);
    const ok = await sendMail({
      to: s.email,
      subject: `New post: ${post.title}`,
      text: `${post.title}\n\n${preview}\n\nRead: ${postUrl}\n\nUnsubscribe: ${unsub}`,
      html: `<h2>${esc(post.title)}</h2>
             ${post.cover_url ? `<p><img src="${esc(post.cover_url)}" alt="" style="max-width:100%;border-radius:8px"></p>` : ''}
             <p>${esc(preview)}</p>
             <p><a href="${postUrl}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Read the post</a></p>
             <hr><p style="font-size:12px;color:#777">You get this because you subscribed to ${esc(config.siteName)}.
             <a href="${unsub}">Unsubscribe</a></p>`,
    });
    if (ok) sent++;
    await sleep(200); // SMTP provider ki rate limit se bachne ke liye
  }
  return sent;
}

let running = false;

// Har minute check: jo post ab publish ho chuki aur jis ki newsletter nahi gayi, us ki bhejo.
// Scheduled posts ke liye bhi yehi kaam karta hai.
async function processPending() {
  if (running) return;
  running = true;
  try {
    if (!mailConfigured || !config.siteUrl) return; // setup nahi hai to posts "pending" hi rehti hain
    const pending = await pool.query(
      `SELECT id FROM posts
       WHERE is_draft = false AND publish_at <= now() AND newsletter_sent = false
         AND publish_at > now() - interval '2 days'
       ORDER BY publish_at ASC`
    );
    for (const row of pending.rows) {
      // Atomic claim: do baar email na jaye
      const claimed = await pool.query(
        'UPDATE posts SET newsletter_sent = true WHERE id = $1 AND newsletter_sent = false RETURNING id, title, excerpt, content, cover_url',
        [row.id]
      );
      if (claimed.rows[0]) {
        const n = await sendPostToSubscribers(claimed.rows[0]);
        console.log(`[newsletter] post ${row.id}: ${n} emails bheji`);
      }
    }
  } catch (err) {
    console.error('[newsletter] error:', err.message);
  } finally {
    running = false;
  }
}

function startNewsletterScheduler() {
  if (!mailConfigured) console.log('[newsletter] SMTP_* set nahi hain, auto-newsletter band hai.');
  else if (!config.siteUrl) console.log('[newsletter] SITE_URL set nahi hai, auto-newsletter band hai.');
  setTimeout(processPending, 10 * 1000);
  setInterval(processPending, 60 * 1000);
}

module.exports = { startNewsletterScheduler, processPending };
