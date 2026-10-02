const pool = require('../db');
const { sendMail } = require('./mailer');
const config = require('../config');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// In-app notification + (optional) email
// footer (optional): email ke neeche chhoti line, jaise "email alerts band karne ka link"
async function notifyUser(userId, message, link, { email = false, emailSubject, footer } = {}) {
  try {
    await pool.query(
      'INSERT INTO notifications (user_id, message, link) VALUES ($1, $2, $3)',
      [userId, message.slice(0, 300), link]
    );
    if (email) {
      const r = await pool.query('SELECT email, username FROM users WHERE id = $1', [userId]);
      const u = r.rows[0];
      if (u) {
        const url = config.siteUrl ? config.siteUrl + link : link;
        await sendMail({
          to: u.email,
          subject: emailSubject || message,
          text: `${message}\n\n${url}` + (footer ? `\n\n${footer}` : ''),
          html: `<p>Hi ${esc(u.username)},</p><p>${esc(message)}</p><p><a href="${url}">Open on ${esc(config.siteName)}</a></p>`
            + (footer ? `<p style="font-size:12px;color:#777">${esc(footer)}</p>` : ''),
        });
      }
    }
  } catch (err) {
    console.error('[notify] fail:', err.message);
  }
}

module.exports = { notifyUser, esc };
