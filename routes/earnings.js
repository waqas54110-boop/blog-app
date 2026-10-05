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
      cfg: {
        readSec: config.earnReadSeconds, readPaisa: config.earnReadPaisa, readCapRs: config.earnReadDailyCapRs,
        invitePaisa: config.earnInvitePaisa, inviteMax: config.earnInviteMax,
      },
    });
  } catch (err) {
    console.error('[earnings] (migration_v29.sql chali?):', err.message);
    next(err);
  }
});

// Post par 1 minute parhne ka inaam. Browser ki script bheje, magar asli faisla server ke waqt par hota hai.
router.post('/earn/read', async (req, res) => {
  try {
    if (!req.session.user) return res.json({ ok: false, code: 'login', error: 'Log in to earn.' });
    const postId = toId(req.body.post_id);
    if (!postId) return res.json({ ok: false, code: 'off', error: 'Invalid post.' });
    const started = req.session.readStart && req.session.readStart[postId];
    const r = await E.claimRead(req.session.user.id, postId, started);
    if (r.ok) return res.json({ ok: true, paisa: r.paisa, amount: E.rs(r.paisa) });
    res.json({ ok: false, code: r.code, error: r.error });
  } catch (err) {
    console.error('[earn read] (migration_v30.sql chali?):', err.message);
    res.json({ ok: false, code: 'error', error: 'Something went wrong.' });
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
