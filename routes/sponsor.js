// Sponsored contest: sponsor link click ginti, sponsor edit, giveaway draw, sponsor report, Telegram test.
const express = require('express');
const pool = require('../db');
const config = require('../config');
const P = require('../lib/polls');
const S = require('../lib/sponsor');
const T = require('../lib/telegram');
const { notifyUser } = require('../lib/notify');

const router = express.Router();
const toId = (v) => (/^\d{1,9}$/.test(String(v)) ? parseInt(v, 10) : null);

const requireAdmin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    return res.status(403).render('404', { code: 403, title: 'Not allowed', message: 'Only the blog owner can do this.' });
  }
  next();
};
// Contest page par message dikhane ke liye (vote page ?error= ko alert mein dikhata hai)
const back = (res, id, msg) => res.redirect(`/votes/${id}${msg ? '?error=' + encodeURIComponent(msg) : ''}#sponsor-admin`);

// Sponsor ke link par click: pehle ginti, phir sponsor ki site (link sirf wahi jo admin ne save kiya, http/https)
router.get('/votes/:id/go', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return next();
    const r = await pool.query('SELECT sponsor_url FROM polls WHERE id = $1', [id]);
    const url = r.rows[0] && r.rows[0].sponsor_url;
    if (!url || !/^https?:\/\//i.test(url)) return res.redirect('/votes/' + id);
    await S.trackClick(req, id);
    res.redirect(url);
  } catch (err) { next(err); }
});

router.post('/votes/:id/sponsor', requireAdmin, async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.redirect('/votes');
    const p = await S.parseSponsor(req.body || {});
    if (p.error) return back(res, id, p.error);
    await S.saveSponsor(id, p.value);
    back(res, id, 'Sponsor & prize saved ✅');
  } catch (err) { next(err); }
});

router.post('/votes/:id/giveaway', requireAdmin, async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.redirect('/votes');
    const r = await S.drawGiveaway(id, req.body.redraw === '1');
    if (r.error) return back(res, id, r.error);

    notifyUser(r.userId, `🎁 You won the giveaway in "${r.title.slice(0, 80)}"! The blog owner will contact you on your account email.`, `/votes/${id}`, {
      email: true, emailSubject: '🎁 You won a giveaway!',
    });
    T.announceGiveaway(id, r.username).catch(() => {});
    back(res, id, `🎉 Winner drawn: ${r.username} (from ${r.count} eligible voter${r.count === 1 ? '' : 's'})`);
  } catch (err) { next(err); }
});

// Sponsor ke liye report (print karke PDF bana len)
router.get('/votes/:id/report', requireAdmin, async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return next();
    const st = await P.loadState(id, null);
    if (!st) return next();
    const [ex, rep] = await Promise.all([S.extras(id), S.report(id)]);
    const created = (await pool.query('SELECT created_at FROM polls WHERE id = $1', [id])).rows[0];
    res.render('vote-report', {
      title: 'Report: ' + st.title,
      st, ex, rep,
      createdAt: created ? created.created_at : null,
      url: (config.siteUrl || `${req.protocol}://${req.get('host')}`) + '/votes/' + id,
    });
  } catch (err) { next(err); }
});

router.post('/votes/telegram-test', requireAdmin, async (req, res, next) => {
  try {
    const r = await T.sendTest();
    const msg = r.ok ? '✅ Test message sent to your Telegram channel.' : '❌ Telegram: ' + (r.error || 'could not send');
    res.redirect('/votes?tg=' + encodeURIComponent(msg));
  } catch (err) { next(err); }
});

module.exports = router;
