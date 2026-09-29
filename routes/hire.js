const express = require('express');
const pool = require('../db');
const config = require('../config');
const { sendMail } = require('../lib/mailer');
const { esc } = require('../lib/notify');

const router = express.Router();

const BUDGETS = ['Not sure yet', 'Under $50', '$50 - $150', '$150 - $500', '$500+'];
const STATUSES = ['new', 'replied', 'closed'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const requireAdmin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    return res.status(403).render('404', { code: 403, title: 'Not allowed', message: 'Only the blog owner can do this.' });
  }
  next();
};

const oneLine = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function renderForm(res, { form = {}, error = null, sent = false, status = 200 } = {}) {
  res.status(status).render('hire', {
    title: 'Hire Me',
    metaDescription: 'Need help with video editing, web development or content creation? Send me a message with your project details.',
    services: config.hireServices,
    budgets: BUDGETS,
    form,
    error,
    sent,
  });
}

// ---------- PUBLIC: Hire Me page ----------
router.get('/hire', (req, res) => {
  const form = { name: req.session.user ? req.session.user.username : '' };
  if (config.hireServices.includes(req.query.service)) form.service = req.query.service;
  renderForm(res, { form, sent: req.query.sent === '1' });
});

router.post('/hire', async (req, res) => {
  const b = req.body || {};

  // Honeypot: insaan ko ye field nazar nahi aata; bot bhar deta hai. Bot ko "sent" dikha do, save mat karo.
  if (String(b.website || '').trim() !== '') return res.redirect('/hire?sent=1');

  const form = {
    name: oneLine(b.name, 100),
    email: oneLine(b.email, 150),
    service: oneLine(b.service, 60),
    budget: oneLine(b.budget, 40),
    message: String(b.message || '').replace(/\r\n/g, '\n').trim(),
  };

  let error = null;
  if (form.name.length < 2) error = 'Please enter your name.';
  else if (!EMAIL_RE.test(form.email)) error = 'Please enter a valid email so I can reply.';
  else if (!config.hireServices.includes(form.service)) error = 'Please choose what you need help with.';
  else if (form.budget && !BUDGETS.includes(form.budget)) error = 'Please choose a budget from the list.';
  else if (form.message.length < 20) error = 'Please describe your project in at least 20 characters.';
  else if (form.message.length > 3000) error = 'Message must be 3000 characters or less.';
  if (error) return renderForm(res, { form, error, status: 400 });

  try {
    const r = await pool.query(
      `INSERT INTO inquiries (name, email, service, budget, message, user_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [form.name, form.email, form.service, form.budget || null, form.message, req.session.user ? req.session.user.id : null]
    );
    notifyOwner({ id: r.rows[0].id, ...form }).catch((e) => console.error('[hire] notify:', e.message));
    res.redirect('/hire?sent=1');
  } catch (err) {
    console.error('[hire]', err.message);
    renderForm(res, { form, error: 'Something went wrong. Please try again in a moment.', status: 500 });
  }
});

// Naye inquiry par owner ko email (SMTP set ho tab); reply-to client ki email hoti hai
async function notifyOwner(q) {
  let to = config.inquiryEmail;
  if (!to) {
    const admins = await pool.query("SELECT email FROM users WHERE role = 'admin'");
    to = admins.rows.map((a) => a.email).join(',');
  }
  if (!to) return;
  const inbox = `${config.siteUrl || ''}/inbox`;
  await sendMail({
    to,
    replyTo: q.email,
    subject: `New inquiry: ${q.service} (${q.name})`,
    text: `${q.name} <${q.email}>\nService: ${q.service}\nBudget: ${q.budget || '-'}\n\n${q.message}\n\nInbox: ${inbox}`,
    html: `<p><b>${esc(q.name)}</b> &lt;${esc(q.email)}&gt;</p>
<p>Service: <b>${esc(q.service)}</b><br>Budget: ${esc(q.budget || '-')}</p>
<p style="white-space:pre-wrap">${esc(q.message)}</p>
<p><a href="${esc(inbox)}">Open inbox</a> &middot; just reply to this email to answer ${esc(q.name)}.</p>`,
  });
}

// ---------- ADMIN: Inbox ----------
router.get('/inbox', requireAdmin, async (req, res) => {
  const filter = STATUSES.includes(req.query.status) ? req.query.status : 'all';
  try {
    const [rows, counts] = await Promise.all([
      pool.query(
        `SELECT id, name, email, service, budget, message, status, created_at
         FROM inquiries WHERE ($1::text = 'all' OR status = $1::text)
         ORDER BY created_at DESC LIMIT 100`,
        [filter]
      ),
      pool.query('SELECT status, COUNT(*)::int AS c FROM inquiries GROUP BY status'),
    ]);
    const count = { new: 0, replied: 0, closed: 0 };
    counts.rows.forEach((r) => { count[r.status] = r.c; });
    res.render('inbox', {
      title: 'Inbox',
      inquiries: rows.rows,
      filter,
      count,
      total: count.new + count.replied + count.closed,
      tz: config.timezone,
    });
  } catch (err) {
    console.error('[inbox]', err.message);
    res.status(500).send('Server error (migration_v6.sql chali hai?)');
  }
});

const toId = (v) => (/^\d{1,9}$/.test(String(v)) ? parseInt(v, 10) : null);
const backTo = (req) => '/inbox' + (STATUSES.includes(req.body.filter) ? '?status=' + req.body.filter : '');

router.post('/inbox/:id/status', requireAdmin, async (req, res) => {
  const id = toId(req.params.id);
  const status = req.body.status;
  if (id && STATUSES.includes(status)) {
    try { await pool.query('UPDATE inquiries SET status = $1 WHERE id = $2', [status, id]); }
    catch (err) { console.error('[inbox status]', err.message); }
  }
  res.redirect(backTo(req));
});

router.post('/inbox/:id/delete', requireAdmin, async (req, res) => {
  const id = toId(req.params.id);
  if (id) {
    try { await pool.query('DELETE FROM inquiries WHERE id = $1', [id]); }
    catch (err) { console.error('[inbox delete]', err.message); }
  }
  res.redirect(backTo(req));
});

module.exports = router;
