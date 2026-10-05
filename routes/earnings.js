// Creators ki kamayi: /earnings (user) aur /admin/payouts (aap, manual JazzCash / Easypaisa).
const express = require('express');
const config = require('../config');
const E = require('../lib/earnings');

const router = express.Router();
const toId = (v) => (/^\d{1,9}$/.test(String(v)) ? parseInt(v, 10) : null);

const requireLogin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  next();
};
const requireAdmin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    return res.status(403).render('404', { code: 403, title: 'Not allowed', message: 'Only the blog owner can do this.' });
  }
  next();
};

const takeFlash = (req) => {
  const f = req.session.earnFlash || null;
  delete req.session.earnFlash;
  return f;
};

// ---------- USER ----------
router.get('/earnings', requireLogin, async (req, res, next) => {
  try {
    if (config.earnEnabled) await E.sync(req.session.user.id);
    const o = await E.overview(req.session.user.id);
    res.render('earnings', {
      title: 'My Earnings', o, flash: takeFlash(req), rs: E.rs,
      enabled: config.earnEnabled, perHundred: config.earnPaisaPerView, // paisa/view = rupees per 100 views
      minRs: config.earnMinWithdrawRs, capRs: config.earnDailyCapRs,
    });
  } catch (err) {
    console.error('[earnings] (migration_v29.sql chali?):', err.message);
    next(err);
  }
});

router.post('/earnings/withdraw', requireLogin, async (req, res, next) => {
  try {
    const r = await E.requestWithdraw(req.session.user.id, req.body);
    req.session.earnFlash = r.error ? { type: 'danger', text: r.error }
      : { type: 'success', text: 'Withdrawal request sent. You will get a notification when it is paid.' };
    res.redirect('/earnings');
  } catch (err) { next(err); }
});

// ---------- ADMIN ----------
router.get('/admin/payouts', requireAdmin, async (req, res, next) => {
  try {
    const d = await E.adminList();
    res.render('admin-payouts', { title: 'Payouts', d, flash: takeFlash(req), rs: E.rs });
  } catch (err) { next(err); }
});

router.post('/admin/payouts/:id/paid', requireAdmin, async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.redirect('/admin/payouts');
    const r = await E.markPaid(id, req.body.txn_ref);
    req.session.earnFlash = r.error ? { type: 'danger', text: r.error } : { type: 'success', text: 'Marked as paid. The user was notified.' };
    res.redirect('/admin/payouts');
  } catch (err) { next(err); }
});

router.post('/admin/payouts/:id/reject', requireAdmin, async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.redirect('/admin/payouts');
    const r = await E.reject(id, req.body.note);
    req.session.earnFlash = r.error ? { type: 'danger', text: r.error } : { type: 'success', text: 'Rejected. The amount went back to the user\'s balance.' };
    res.redirect('/admin/payouts');
  } catch (err) { next(err); }
});

module.exports = router;
