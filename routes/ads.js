// Advertise on Khabzo (V39): /advertise (packages + form + dashboard), /businesses (paid listings),
// /ads/:id/go (click counting), /admin/ads (approve, mark paid, top-ups).
const express = require('express');
const pool = require('../db');
const spam = require('../lib/spam');
const Restricted = require('../lib/restricted');
const A = require('../lib/ads');
const Images = require('../lib/images');
const { notifyUser } = require('../lib/notify');

const router = express.Router();

const toId = (v) => (/^\d{1,9}$/.test(String(v)) ? parseInt(v, 10) : null);
const needLogin = (req, res, back) => { req.session.returnTo = back; res.redirect('/login'); };
const requireAdmin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') return res.status(403).render('404', { code: 403, title: 'Not allowed', message: 'Only the site owner can do this.' });
  next();
};
const STATE_SQL = `CASE WHEN a.status = 'active' AND a.ends_at IS NOT NULL AND a.ends_at <= now() THEN 'ended' ELSE a.status END`;
const flash = (req) => ({
  msg: req.query.msg ? String(req.query.msg).slice(0, 200) : null,
  error: req.query.error ? String(req.query.error).slice(0, 200) : null,
});

// ---------- PUBLIC: packages + prices ----------
router.get('/advertise', (req, res) => {
  res.render('advertise', {
    title: 'Advertise on Khabzo - banners, sponsored posts and business listings',
    metaDescription: 'Promote your business to Pakistani readers on Khabzo: banner ads, sponsored posts in the community feed, a featured local business listing, sponsored contests and pay-per-click ads.',
    cfg: A.cfg, UNITS: A.UNITS, CATEGORIES: A.CATEGORIES,
  });
});

// ---------- ADVERTISER: new ad ----------
const emptyForm = (kind) => ({ kind, placement: 'all', units: kind && A.UNITS[kind] ? String(A.UNITS[kind].opts[0]) : '' });
const renderNew = (res, code, kind, f, error) =>
  res.status(code).render('ad-new', {
    title: 'Create an ad - ' + A.KIND_LABEL[kind], kind, f, error: error || null,
    robots: 'noindex,nofollow',
    cfg: A.cfg, UNITS: A.UNITS, CATEGORIES: A.CATEGORIES, PLACEMENTS: A.PLACEMENTS, KIND_LABEL: A.KIND_LABEL,
  });

router.get('/advertise/new', (req, res) => {
  const kind = A.KINDS.includes(req.query.kind) ? req.query.kind : null;
  if (!kind) return res.redirect('/advertise');
  if (!req.session.user) return needLogin(req, res, '/advertise/new?kind=' + kind);
  renderNew(res, 200, kind, emptyForm(kind));
});

router.post('/advertise', async (req, res, next) => {
  try {
    const kind = A.KINDS.includes(req.body.kind) ? req.body.kind : null;
    if (!kind) return res.redirect('/advertise');
    if (!req.session.user) return needLogin(req, res, '/advertise/new?kind=' + kind);
    const me = req.session.user;
    const b = req.body || {};
    const f = {
      kind,
      business_name: A.oneLine(b.business_name, 80),
      tagline: A.oneLine(b.tagline, 120),
      body: A.multiLine(b.body, 500),
      link: A.oneLine(b.link, 500),
      phone: A.oneLine(b.phone, 20),
      whatsapp: A.oneLine(b.whatsapp, 20),
      city: A.oneLine(b.city, 60),
      area: A.oneLine(b.area, 80),
      category: String(b.category || ''),
      placement: Object.keys(A.PLACEMENTS).includes(b.placement) ? b.placement : 'all',
      units: String(b.units || ''),
      image_id: toId(b.image_id) || '',
    };
    const fail = (m) => renderNew(res, 400, kind, f, m);

    if (f.business_name.length < 3) return fail('Please enter your business or brand name (at least 3 characters).');
    const link = A.cleanLink(f.link);
    if (!link.ok) return fail('That website link is not valid. Use a full address like https://example.com');
    const phone = A.cleanPhone(f.phone);
    if (phone === null) return fail('Please enter a valid phone number, for example 0300 1234567.');
    const wa = A.cleanPhone(f.whatsapp);
    if (wa === null) return fail('Please enter a valid WhatsApp number, for example 0300 1234567.');

    let units = null;
    let price = 0;
    if (A.UNITS[kind]) {
      units = parseInt(f.units, 10);
      price = A.priceFor(kind, units);
      if (!price) return fail('Please choose how long the ad should run.');
    }

    if (kind === 'contest') {
      if (f.body.length < 40) return fail('Please tell us what you want: the prize, your goal, your budget and when (at least 40 characters).');
      if (!phone && !wa) return fail('Please add a phone or WhatsApp number so we can contact you about the contest.');
    } else if (kind === 'listing') {
      if (f.city.length < 2) return fail('Please enter your city.');
      if (!A.CATEGORIES.includes(f.category)) return fail('Please choose a category.');
      if (f.body.length < 30) return fail('Please describe your business in at least 30 characters.');
      if (!link.url && !phone && !wa) return fail('Please add at least one way for customers to reach you: website, phone or WhatsApp.');
    } else {
      if (f.tagline.length < 8) return fail('Please write a short headline (at least 8 characters).');
      if (!link.url && !phone && !wa) return fail('Please add a website link, phone or WhatsApp number. People need somewhere to go after they click.');
    }

    const v = await spam.check([f.business_name, f.tagline, f.body].join('\n'), { userId: me.id, isAdmin: me.role === 'admin' });
    if (me.role !== 'admin' && await Restricted.find([f.business_name, f.tagline, f.body].join('\n'))) return fail(Restricted.MSG_EN);
    if (v.action !== 'ok') return fail('Your text was stopped by the spam filter (spam words, repeated text or too many links). Please rewrite it and try again.');

    if (me.role !== 'admin') {
      const lim = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS day,
                COUNT(*) FILTER (WHERE status IN ('pending', 'awaiting_payment', 'active', 'paused'))::int AS open
           FROM ads WHERE user_id = $1`, [me.id]);
      if (lim.rows[0].day >= 5) return fail('You can submit up to 5 ads per day. Please try again tomorrow.');
      if (lim.rows[0].open >= 15) return fail('You already have 15 open ads. Please finish or delete some first.');
    }

    let img = null;
    if (f.image_id && kind !== 'contest') {
      const ok = await pool.query(`SELECT id FROM images WHERE id = $1 AND uploaded_by = $2 AND ${Images.unusedSql('$1')}`, [f.image_id, me.id]);
      if (!ok.rows[0]) return fail('That picture could not be used. Please upload it again.');
      img = f.image_id;
    }

    const ins = await pool.query(
      `INSERT INTO ads (user_id, kind, business_name, tagline, body, link_url, phone, whatsapp, city, area, category, image_id, placement, units, price_rs, cpc_paise)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [me.id, kind, f.business_name, f.tagline || null, f.body || null, link.url || null, phone || null, wa || null,
        f.city || null, f.area || null,
        kind === 'listing' ? f.category : (A.CATEGORIES.includes(f.category) ? f.category : null),
        img, kind === 'cpc' || kind === 'banner' ? f.placement : 'all', units, price,
        kind === 'cpc' ? A.cfg.cpcRs * 100 : null]);
    res.redirect('/advertise/' + ins.rows[0].id + '?msg=' + encodeURIComponent('Thank you! Your ad was submitted. The site owner will review it and you will get a notification.'));
  } catch (err) { next(err); }
});

// ---------- ADVERTISER: dashboard ----------
router.get('/advertise/dashboard', async (req, res, next) => {
  try {
    if (!req.session.user) return needLogin(req, res, '/advertise/dashboard');
    const uid = req.session.user.id;
    const [ads, wallet, topups] = await Promise.all([
      pool.query(`SELECT a.*, ${STATE_SQL} AS state FROM ads a WHERE a.user_id = $1 ORDER BY a.id DESC LIMIT 100`, [uid]),
      pool.query('SELECT balance_paise, total_topup_paise, total_spent_paise FROM ad_wallets WHERE user_id = $1', [uid]),
      pool.query('SELECT id, amount_rs, method, txn_ref, status, created_at FROM ad_topups WHERE user_id = $1 ORDER BY id DESC LIMIT 10', [uid]),
    ]);
    res.render('ad-dashboard', {
      title: 'My ads', robots: 'noindex,nofollow',
      ads: ads.rows,
      wallet: wallet.rows[0] || { balance_paise: 0, total_topup_paise: 0, total_spent_paise: 0 },
      topups: topups.rows, cfg: A.cfg, rs: A.rs, KIND_LABEL: A.KIND_LABEL, METHODS: A.METHODS, ...flash(req),
    });
  } catch (err) { next(err); }
});

router.post('/advertise/topup', async (req, res, next) => {
  try {
    if (!req.session.user) return needLogin(req, res, '/advertise/dashboard');
    const amount = parseInt(req.body.amount_rs, 10);
    const method = A.METHODS.includes(req.body.method) ? req.body.method : null;
    const ref = A.oneLine(req.body.txn_ref, 60);
    const back = (m, k) => res.redirect('/advertise/dashboard?' + (k || 'error') + '=' + encodeURIComponent(m) + '#wallet');
    if (!amount || amount < A.cfg.minTopupRs || amount > 1000000) return back(`The minimum top-up is Rs ${A.cfg.minTopupRs}.`);
    if (!method) return back('Please choose how you paid.');
    if (ref.length < 4) return back('Please enter the transaction ID of your payment.');
    const open = await pool.query(`SELECT COUNT(*)::int AS n FROM ad_topups WHERE user_id = $1 AND status = 'pending'`, [req.session.user.id]);
    if (open.rows[0].n >= 3) return back('You already have 3 top-ups waiting for approval.');
    await pool.query('INSERT INTO ad_topups (user_id, amount_rs, method, txn_ref) VALUES ($1,$2,$3,$4)', [req.session.user.id, amount, method, ref]);
    back('Top-up request sent. Your wallet is credited as soon as the owner confirms the payment.', 'msg');
  } catch (err) { next(err); }
});

// ---------- ADVERTISER / ADMIN: one ad report ----------
router.get('/advertise/:id', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return next();
    if (!req.session.user) return needLogin(req, res, '/advertise/' + id);
    const r = await pool.query(`SELECT a.*, ${STATE_SQL} AS state, u.username FROM ads a JOIN users u ON u.id = a.user_id WHERE a.id = $1`, [id]);
    const ad = r.rows[0];
    if (!ad) return next();
    if (ad.user_id !== req.session.user.id && req.session.user.role !== 'admin') {
      return res.status(403).render('404', { code: 403, title: 'Not allowed', message: 'This ad belongs to someone else.' });
    }
    const d = await pool.query('SELECT day, views, clicks FROM ad_daily WHERE ad_id = $1 ORDER BY day DESC LIMIT 30', [id]);
    res.render('ad-report', {
      title: 'Ad report - ' + ad.business_name, robots: 'noindex,nofollow',
      ad, daily: d.rows, cfg: A.cfg, rs: A.rs, KIND_LABEL: A.KIND_LABEL, PLACEMENTS: A.PLACEMENTS, UNITS: A.UNITS, ...flash(req),
    });
  } catch (err) { next(err); }
});

// Express 5 does not accept "(a|b)" inside a path, so the action is checked here
router.post('/advertise/:id/:action', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    const act = req.params.action;
    if (!['pause', 'resume', 'delete'].includes(act)) return next();
    if (!req.session.user || !id) return res.redirect('/login');
    const me = req.session.user;
    const r = await pool.query('SELECT user_id, status, image_id FROM ads WHERE id = $1', [id]);
    const ad = r.rows[0];
    if (!ad || (ad.user_id !== me.id && me.role !== 'admin')) return res.redirect('/advertise/dashboard');
    if (act === 'pause' && ad.status === 'active') await pool.query(`UPDATE ads SET status = 'paused', updated_at = now() WHERE id = $1`, [id]);
    else if (act === 'resume' && ad.status === 'paused') await pool.query(`UPDATE ads SET status = 'active', updated_at = now() WHERE id = $1`, [id]);
    else if (act === 'delete' && ['pending', 'awaiting_payment', 'rejected', 'ended', 'paused'].includes(ad.status)) {
      await pool.query('DELETE FROM ads WHERE id = $1', [id]);
      if (ad.image_id) await Images.dropIfOrphan(ad.image_id, null).catch(() => {});
      return res.redirect('/advertise/dashboard?msg=' + encodeURIComponent('Ad deleted.'));
    }
    res.redirect('/advertise/' + id);
  } catch (err) { next(err); }
});

// ---------- CLICK (counts, then sends the visitor on) ----------
router.get('/ads/:id/go', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return next();
    const r = await pool.query(`SELECT * FROM ads WHERE id = $1 AND kind <> 'contest'`, [id]);
    const ad = r.rows[0];
    if (!ad) return next();
    // Only running ads (or the advertiser / admin previewing) may redirect, so this is not an open redirect for pending ads
    if (ad.status !== 'active' && !A.isOwner(req, ad)) return next();
    const to = ['link', 'wa', 'call'].includes(req.query.to) ? req.query.to : (ad.link_url ? 'link' : ad.whatsapp ? 'wa' : 'call');
    let dest = null;
    if (to === 'link' && ad.link_url) dest = ad.link_url;
    else if (to === 'wa' && ad.whatsapp) dest = 'https://wa.me/' + ad.whatsapp;
    else if (to === 'call' && (ad.phone || ad.whatsapp)) dest = 'tel:+' + (ad.phone || ad.whatsapp);
    if (!dest) return next();
    await A.recordClick(req, ad);
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Robots-Tag', 'noindex');
    res.redirect(302, dest);
  } catch (err) { next(err); }
});

// ---------- LOCAL BUSINESSES (paid listings) ----------
const LISTING_WHERE = `a.kind = 'listing' AND a.status = 'active' AND a.starts_at <= now() AND a.ends_at > now()`;

router.get('/businesses', async (req, res, next) => {
  try {
    const city = A.oneLine(req.query.city, 60);
    const cat = A.CATEGORIES.includes(String(req.query.cat || '')) ? String(req.query.cat) : '';
    const q = A.oneLine(req.query.q, 60);
    const where = [LISTING_WHERE];
    const params = [];
    if (city) { params.push(city.toLowerCase()); where.push(`lower(a.city) = $${params.length}`); }
    if (cat) { params.push(cat); where.push(`a.category = $${params.length}`); }
    if (q) {
      params.push('%' + q.replace(/[%_\\]/g, (m) => '\\' + m) + '%');
      where.push(`(a.business_name ILIKE $${params.length} OR a.tagline ILIKE $${params.length} OR a.body ILIKE $${params.length})`);
    }
    const [r, cities] = await Promise.all([
      pool.query(`SELECT a.id, a.user_id, a.business_name, a.tagline, a.body, a.city, a.area, a.category, a.image_id, a.link_url, a.phone, a.whatsapp
                    FROM ads a WHERE ${where.join(' AND ')}
                   ORDER BY md5(a.id::text || ${A.DAY_SQL}::text) LIMIT 60`, params),
      pool.query(`SELECT MIN(city) AS city, COUNT(*)::int AS n FROM ads a WHERE ${LISTING_WHERE} GROUP BY lower(city) ORDER BY n DESC LIMIT 12`),
    ]);
    A.recordViews(req, r.rows);
    res.render('businesses', {
      title: city ? `Local businesses in ${city} - Khabzo` : 'Local Businesses in Pakistan - Khabzo',
      metaDescription: 'Find local businesses in your city: food, shopping, tuition, clinics, repairs and more. Call or WhatsApp them directly.',
      list: r.rows, cities: cities.rows, CATEGORIES: A.CATEGORIES, f: { city, cat, q },
    });
  } catch (err) { next(err); }
});

router.get('/businesses/:id', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return next();
    const r = await pool.query(`SELECT a.* FROM ads a WHERE a.id = $1 AND ${LISTING_WHERE}`, [id]);
    const b = r.rows[0];
    if (!b) return next();
    A.recordViews(req, [b]);
    res.render('business', {
      title: `${b.business_name}${b.city ? ' - ' + b.city : ''}`,
      metaDescription: (b.tagline || b.body || '').slice(0, 155),
      b,
    });
  } catch (err) { next(err); }
});

// ---------- ADMIN ----------
router.get('/admin/ads', requireAdmin, async (req, res, next) => {
  try {
    const sel = (cond, order, lim) => pool.query(
      `SELECT a.*, ${STATE_SQL} AS state, u.username, u.email FROM ads a JOIN users u ON u.id = a.user_id WHERE ${cond} ORDER BY ${order} LIMIT ${lim}`);
    const [pending, awaiting, active, recent, topups, totals] = await Promise.all([
      sel(`a.status = 'pending'`, 'a.id', 50),
      sel(`a.status = 'awaiting_payment'`, 'a.id', 50),
      sel(`a.status IN ('active', 'paused') AND (a.ends_at IS NULL OR a.ends_at > now())`, 'a.id DESC', 100),
      sel(`a.status IN ('rejected', 'ended') OR (a.status = 'active' AND a.ends_at <= now())`, 'a.updated_at DESC', 20),
      pool.query(`SELECT t.*, u.username FROM ad_topups t JOIN users u ON u.id = t.user_id WHERE t.status = 'pending' ORDER BY t.id`),
      pool.query(`SELECT COALESCE(SUM(price_rs) FILTER (WHERE paid_at IS NOT NULL), 0)::int AS fixed_rs,
                         (SELECT COALESCE(SUM(amount_rs), 0)::int FROM ad_topups WHERE status = 'approved') AS topup_rs FROM ads`),
    ]);
    res.render('admin-ads', {
      title: 'Ads admin', robots: 'noindex,nofollow',
      pending: pending.rows, awaiting: awaiting.rows, active: active.rows, recent: recent.rows,
      topups: topups.rows, totals: totals.rows[0], cfg: A.cfg, rs: A.rs, KIND_LABEL: A.KIND_LABEL, ...flash(req),
    });
  } catch (err) { next(err); }
});

router.post('/admin/ads/topups/:id/:action', requireAdmin, async (req, res, next) => {
  const id = toId(req.params.id);
  const action = req.params.action;
  if (!['approve', 'reject'].includes(action)) return next();
  if (!id) return res.redirect('/admin/ads');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = await client.query(
      `UPDATE ad_topups SET status = $2, decided_at = now() WHERE id = $1 AND status = 'pending' RETURNING user_id, amount_rs`,
      [id, action === 'approve' ? 'approved' : 'rejected']);
    if (t.rows[0] && action === 'approve') {
      const paise = t.rows[0].amount_rs * 100;
      await client.query(
        `INSERT INTO ad_wallets (user_id, balance_paise, total_topup_paise) VALUES ($1, $2, $2)
         ON CONFLICT (user_id) DO UPDATE SET balance_paise = ad_wallets.balance_paise + $2, total_topup_paise = ad_wallets.total_topup_paise + $2`,
        [t.rows[0].user_id, paise]);
    }
    await client.query('COMMIT');
    if (t.rows[0]) {
      notifyUser(t.rows[0].user_id,
        action === 'approve' ? `Your ad wallet was topped up with Rs ${t.rows[0].amount_rs}.` : 'Your wallet top-up could not be confirmed. Please check the transaction ID and try again.',
        '/advertise/dashboard#wallet');
    }
    res.redirect('/admin/ads?msg=' + encodeURIComponent('Top-up ' + (action === 'approve' ? 'approved.' : 'rejected.')));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally { client.release(); }
});

router.post('/admin/ads/:id/:action', requireAdmin, async (req, res, next) => {
  try {
    const act = req.params.action;
    if (!['approve', 'reject', 'paid', 'end', 'pause', 'resume'].includes(act)) return next();
    const id = toId(req.params.id);
    if (!id) return res.redirect('/admin/ads');
    const note = A.oneLine(req.body.note, 300) || null;
    const r = await pool.query('SELECT * FROM ads WHERE id = $1', [id]);
    const ad = r.rows[0];
    if (!ad) return res.redirect('/admin/ads');
    const fixed = ['banner', 'feed', 'listing'].includes(ad.kind);
    let msg = 'Done.';

    if (act === 'approve' && ad.status === 'pending') {
      if (fixed) {
        await pool.query(`UPDATE ads SET status = 'awaiting_payment', admin_note = $2, updated_at = now() WHERE id = $1`, [id, note]);
        notifyUser(ad.user_id, `Your ad "${ad.business_name}" was approved. Please pay Rs ${ad.price_rs} to start it.`, '/advertise/' + id);
      } else {
        await pool.query(`UPDATE ads SET status = 'active', starts_at = now(), admin_note = $2, updated_at = now() WHERE id = $1`, [id, note]);
        notifyUser(ad.user_id, ad.kind === 'cpc'
          ? `Your pay-per-click ad "${ad.business_name}" is approved. It runs while your wallet has money.`
          : `We received your contest request "${ad.business_name}" and will contact you soon.`, '/advertise/' + id);
      }
    } else if (act === 'reject' && ['pending', 'awaiting_payment'].includes(ad.status)) {
      await pool.query(`UPDATE ads SET status = 'rejected', admin_note = $2, updated_at = now() WHERE id = $1`, [id, note || 'Not approved.']);
      notifyUser(ad.user_id, `Your ad "${ad.business_name}" was not approved.${note ? ' Reason: ' + note : ''}`, '/advertise/' + id);
    } else if (act === 'paid' && fixed && ['pending', 'awaiting_payment'].includes(ad.status)) {
      const days = A.UNITS[ad.kind].days * ad.units;
      await pool.query(
        `UPDATE ads SET status = 'active', paid_at = now(), starts_at = now(), ends_at = now() + ($2 || ' days')::interval,
                admin_note = COALESCE($3, admin_note), updated_at = now() WHERE id = $1`,
        [id, String(days), note]);
      notifyUser(ad.user_id, `Payment received. Your ad "${ad.business_name}" is live for ${ad.units} ${A.UNITS[ad.kind].word}${ad.units > 1 ? 's' : ''}.`, '/advertise/' + id);
    } else if (act === 'end' && ['active', 'paused', 'awaiting_payment'].includes(ad.status)) {
      await pool.query(`UPDATE ads SET status = 'ended', updated_at = now() WHERE id = $1`, [id]);
    } else if (act === 'pause' && ad.status === 'active') {
      await pool.query(`UPDATE ads SET status = 'paused', updated_at = now() WHERE id = $1`, [id]);
    } else if (act === 'resume' && ad.status === 'paused') {
      await pool.query(`UPDATE ads SET status = 'active', updated_at = now() WHERE id = $1`, [id]);
    } else msg = 'Nothing changed (the ad was not in the right state).';

    res.redirect('/admin/ads?msg=' + encodeURIComponent(msg));
  } catch (err) { next(err); }
});

module.exports = router;
