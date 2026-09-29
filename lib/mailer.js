const nodemailer = require('nodemailer');

// SMTP settings .env se (Brevo / Resend / Gmail app-password sab chalte hain)
const configured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

const transporter = configured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'no-reply@example.com';

// Email fail ho to site kabhi crash nahi hogi, sirf log hoga.
async function sendMail({ to, subject, html, text }) {
  if (!transporter) {
    console.log('[mail] SMTP set nahi hai, email skip:', subject, '->', to);
    return false;
  }
  try {
    await transporter.sendMail({ from, to, subject, html, text });
    return true;
  } catch (err) {
    console.error('[mail] send fail:', to, err.message);
    return false;
  }
}

module.exports = { sendMail, mailConfigured: configured };
