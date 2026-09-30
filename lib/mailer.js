const nodemailer = require('nodemailer');

// Email bhejne ke 3 tareeqe (jo pehle set ho wahi chalta hai, is tarteeb se):
//   1) BREVO_API_KEY                        -> Brevo HTTPS API
//   2) MAILJET_API_KEY + MAILJET_SECRET_KEY -> Mailjet HTTPS API
//   3) SMTP2GO_API_KEY                      -> SMTP2GO HTTPS API
//   4) RESEND_API_KEY                       -> Resend HTTPS API (apna domain verify hona chahiye)
//   5) SMTP_HOST/USER/PASS                  -> SMTP (Railway free/hobby/trial par port 587/465 band hote hain, wahan na chalega)
// 1-4 HTTPS par chalte hain, is liye Railway par theek kaam karte hain. In mein se kisi mein apna domain zaroori nahi
// (sirf Resend ko chhor kar): bas MAIL_FROM wali email un ke paas verified sender ho.
const BREVO_KEY = process.env.BREVO_API_KEY || '';
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const MAILJET_KEY = process.env.MAILJET_API_KEY || '';
const MAILJET_SECRET = process.env.MAILJET_SECRET_KEY || '';
const SMTP2GO_KEY = process.env.SMTP2GO_API_KEY || '';
const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

const provider = BREVO_KEY ? 'brevo'
  : (MAILJET_KEY && MAILJET_SECRET) ? 'mailjet'
  : SMTP2GO_KEY ? 'smtp2go'
  : RESEND_KEY ? 'resend'
  : smtpConfigured ? 'smtp'
  : null;
const configured = !!provider;

const transporter = provider === 'smtp'
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'no-reply@example.com';

// 'My Blog <you@x.com>' -> { name: 'My Blog', email: 'you@x.com' }
function parseFrom(v) {
  const m = String(v).match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim(), email: m[2].trim() } : { name: '', email: String(v).trim() };
}

async function postJson(url, headers, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`${res.status} ${detail}`);
  }
}

// Email fail ho to site kabhi crash nahi hogi, sirf log hoga.
async function sendMail({ to, subject, html, text, replyTo }) {
  if (!provider) {
    console.log('[mail] Email set nahi hai (BREVO / MAILJET / SMTP2GO / RESEND API key ya SMTP), email skip:', subject, '->', to);
    return false;
  }
  const toList = (Array.isArray(to) ? to : [to]).filter(Boolean);
  try {
    if (provider === 'brevo') {
      const sender = parseFrom(from);
      await postJson('https://api.brevo.com/v3/smtp/email', { 'api-key': BREVO_KEY }, {
        sender: sender.name ? sender : { email: sender.email },
        to: toList.map((email) => ({ email })),
        subject,
        ...(html ? { htmlContent: html } : {}),
        ...(text ? { textContent: text } : {}),
        ...(replyTo ? { replyTo: { email: replyTo } } : {}),
      });
    } else if (provider === 'mailjet') {
      const sender = parseFrom(from);
      const auth = 'Basic ' + Buffer.from(`${MAILJET_KEY}:${MAILJET_SECRET}`).toString('base64');
      await postJson('https://api.mailjet.com/v3.1/send', { Authorization: auth }, {
        Messages: [{
          From: sender.name ? { Email: sender.email, Name: sender.name } : { Email: sender.email },
          To: toList.map((email) => ({ Email: email })),
          Subject: subject,
          ...(text ? { TextPart: text } : {}),
          ...(html ? { HTMLPart: html } : {}),
          ...(replyTo ? { ReplyTo: { Email: replyTo } } : {}),
        }],
      });
    } else if (provider === 'smtp2go') {
      await postJson('https://api.smtp2go.com/v3/email/send', { 'X-Smtp2go-Api-Key': SMTP2GO_KEY }, {
        sender: from,
        to: toList,
        subject,
        ...(text ? { text_body: text } : {}),
        ...(html ? { html_body: html } : {}),
        ...(replyTo ? { custom_headers: [{ header: 'Reply-To', value: replyTo }] } : {}),
      });
    } else if (provider === 'resend') {
      await postJson('https://api.resend.com/emails', { Authorization: 'Bearer ' + RESEND_KEY }, {
        from,
        to: toList,
        subject,
        ...(html ? { html } : {}),
        ...(text ? { text } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
      });
    } else {
      await transporter.sendMail({ from, to, subject, html, text, ...(replyTo ? { replyTo } : {}) });
    }
    return true;
  } catch (err) {
    console.error(`[mail] send fail (${provider}):`, toList.join(','), err.message);
    return false;
  }
}

module.exports = { sendMail, mailConfigured: configured };
