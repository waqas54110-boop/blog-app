// Advertise on Khabzo (V39): prices, validation, ad picking, view / click counting.
const crypto = require('crypto');
const pool = require('../db');
const { isBot } = require('./analytics');
const { notifyUser } = require('./notify');

const num = (v, d, lo, hi) => Math.min(Math.max(parseInt(v, 10) || d, lo), hi);

const cfg = {
  bannerWeekRs: num(process.env.AD_BANNER_RS_WEEK, 500, 1, 1000000),
  feedDayRs: num(process.env.AD_FEED_RS_DAY, 300, 1, 1000000),
  listingMonthRs: num(process.env.AD_LISTING_RS_MONTH, 1000, 1, 1000000),
  contestFromRs: num(process.env.AD_CONTEST_RS, 5000, 1, 10000000),
  cpcRs: num(process.env.AD_CPC_RS, 3, 1, 100), // Rs per real click (suggested range 2-5)
  minTopupRs: num(process.env.AD_MIN_TOPUP_RS, 500, 50, 1000000),
  payInfo: process.env.AD_PAY_INFO || 'After you submit, the site owner will confirm your ad and send the JazzCash / Easypaisa account details.',
  contact: process.env.AD_CONTACT || '',
};

const KINDS = ['banner', 'feed', 'listing', 'cpc', 'contest'];
const UNITS = {
  banner: { opts: [1, 2, 4], word: 'week', days: 7, rate: cfg.bannerWeekRs },
  feed: { opts: [1, 3, 7, 14, 30], word: 'day', days: 1, rate: cfg.feedDayRs },
  listing: { opts: [1, 3, 6, 12], word: 'month', days: 30, rate: cfg.listingMonthRs },
};
const KIND_LABEL = { banner: 'Banner ad', feed: 'Sponsored post', listing: 'Business listing', cpc: 'Pay-per-click', contest: 'Sponsored contest' };
const CATEGORIES = ['Food & Restaurants', 'Shopping', 'Education & Tuition', 'Health & Clinics', 'Services & Repair', 'Beauty & Salon', 'Real Estate', 'Tech & Freelancing', 'Events & Weddings', 'Other'];
const PLACEMENTS = { home: 'Home page', feed: 'Community feed', post: 'Blog posts', all: 'Everywhere' };
const METHODS = ['JazzCash', 'Easypaisa', 'Bank transfer'];

const priceFor = (kind, units) => (UNITS[kind] && UNITS[kind].opts.includes(units) ? UNITS[kind].rate * units : 0);
const rs = (paise) => (Number(paise || 0) / 100).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const DAY_SQL = `(now() AT TIME ZONE 'Asia/Karachi')::date`;

// ---------- validation helpers ----------
const oneLine = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const multiLine = (v, max) => String(v || '').replace(/\r/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

// Link: only http / https, no user:pass. Empty input gives ''.
function cleanLink(raw) {
  let t = String(raw || '').trim();
  if (!t) return { ok: true, url: '' };
  if (!/^https?:\/\//i.test(t)) t = 'https://' + t;
  try {
    const u = new URL(t);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || !u.hostname.includes('.')) return { ok: false };
    const s = u.toString();
    return s.length > 500 ? { ok: false } : { ok: true, url: s };
  } catch (e) { return { ok: false }; }
}

// Pakistani number: 0300-1234567 -> 923001234567. Empty gives ''. Invalid gives null.
function cleanPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '92' + d.slice(1);
  return /^\d{10,14}$/.test(d) ? d : null;
}

// ---------- which pages show a banner ----------
function placeOf(path, query) {
  if (path === '/') return query && (query.tab || query.user || query.before) ? 'feed' : 'home';
  if (/^\/feed(\/|$)/.test(path)) return 'feed';
  if (path === '/blog' || /^\/posts\/(?!new$)[^/]+$/.test(path)) return 'post';
  if (/^\/(community|creators|trends|petitions|court|businesses|leaderboard|votes|groups)(\/|$)/.test(path) && !/\/(new|manage|chat)(\/|$)/.test(path)) return 'other';
  return null;
}

const SHOW_COLS = 'a.id, a.user_id, a.kind, a.business_name, a.tagline, a.link_url, a.phone, a.whatsapp, a.image_id, a.city';

// Banner slot: fixed banners first (random rotation), then funded pay-per-click ads
async function bannerFor(req) {
  const place = placeOf(req.path, req.query);
  if (!place) return null;
  const r = await pool.query(
    `SELECT ${SHOW_COLS} FROM ads a LEFT JOIN ad_wallets w ON w.user_id = a.user_id
      WHERE a.status = 'active' AND (a.placement = $1 OR a.placement = 'all')
        AND ( (a.kind = 'banner' AND a.starts_at <= now() AND a.ends_at > now())
           OR (a.kind = 'cpc' AND COALESCE(w.balance_paise, 0) >= a.cpc_paise) )
      ORDER BY (a.kind = 'banner') DESC, random() LIMIT 1`,
    [place === 'other' ? 'all' : place]);
  return r.rows[0] || null;
}

// Feed slot: sponsored post ads, then funded pay-per-click ads that picked feed / everywhere
async function feedAdFor() {
  const r = await pool.query(
    `SELECT ${SHOW_COLS}, a.body FROM ads a LEFT JOIN ad_wallets w ON w.user_id = a.user_id
      WHERE a.status = 'active'
        AND ( (a.kind = 'feed' AND a.starts_at <= now() AND a.ends_at > now())
           OR (a.kind = 'cpc' AND a.placement IN ('feed', 'all') AND COALESCE(w.balance_paise, 0) >= a.cpc_paise) )
      ORDER BY (a.kind = 'feed') DESC, random() LIMIT 1`);
  return r.rows[0] || null;
}

// ---------- counting ----------
const isOwner = (req, ad) => {
  const me = req.session && req.session.user;
  return !!me && (me.id === ad.user_id || me.role === 'admin');
};

function visitorHash(req) {
  return crypto.createHash('sha256').update(`${req.ip}|${req.get('User-Agent') || ''}|${process.env.SESSION_SECRET || ''}`).digest('hex').slice(0, 32);
}

// Views: bots, the advertiser and the admin are not counted
async function recordViews(req, ads) {
  try {
    if (isBot(req)) return;
    const ids = (ads || []).filter((a) => a && !isOwner(req, a)).map((a) => a.id);
    if (!ids.length) return;
    await pool.query(
      `INSERT INTO ad_daily (ad_id, day, views, clicks) SELECT x, ${DAY_SQL}, 1, 0 FROM unnest($1::int[]) x
       ON CONFLICT (ad_id, day) DO UPDATE SET views = ad_daily.views + 1`, [ids]);
    await pool.query('UPDATE ads SET views = views + 1 WHERE id = ANY($1::int[])', [ids]);
  } catch (e) { console.error('[ads] views:', e.message); }
}

// Click: true if it was counted. A pay-per-click ad takes money from the wallet (inside a transaction).
async function recordClick(req, ad) {
  if (isBot(req) || isOwner(req, ad)) return false;
  const now = new Date();
  const serving = ad.status === 'active' && (ad.kind === 'cpc' || (ad.ends_at && new Date(ad.ends_at) > now && ad.starts_at && new Date(ad.starts_at) <= now));
  if (!serving) return false;
  const client = await pool.connect();
  let lowBalance = false;
  try {
    await client.query('BEGIN');
    const seen = await client.query(
      `INSERT INTO ad_click_seen (ad_id, visitor, day) VALUES ($1, $2, ${DAY_SQL}) ON CONFLICT DO NOTHING`,
      [ad.id, visitorHash(req)]);
    if (seen.rowCount === 0) { await client.query('ROLLBACK'); return false; }
    if (ad.kind === 'cpc') {
      const w = await client.query(
        `UPDATE ad_wallets SET balance_paise = balance_paise - $2, total_spent_paise = total_spent_paise + $2
          WHERE user_id = $1 AND balance_paise >= $2 RETURNING balance_paise`,
        [ad.user_id, ad.cpc_paise]);
      if (!w.rows[0]) { await client.query('ROLLBACK'); return false; }
      lowBalance = Number(w.rows[0].balance_paise) < ad.cpc_paise;
      await client.query('UPDATE ads SET spent_paise = spent_paise + $2 WHERE id = $1', [ad.id, ad.cpc_paise]);
    }
    await client.query('UPDATE ads SET clicks = clicks + 1 WHERE id = $1', [ad.id]);
    await client.query(
      `INSERT INTO ad_daily (ad_id, day, views, clicks) VALUES ($1, ${DAY_SQL}, 0, 1)
       ON CONFLICT (ad_id, day) DO UPDATE SET clicks = ad_daily.clicks + 1`, [ad.id]);
    await client.query('COMMIT');
    if (lowBalance) notifyUser(ad.user_id, 'Your ad wallet is empty, so your pay-per-click ads have stopped. Top up to start them again.', '/advertise/dashboard#wallet');
    if (Math.random() < 0.02) pool.query(`DELETE FROM ad_click_seen WHERE day < ${DAY_SQL} - 3`).catch(() => {});
    return true;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[ads] click:', e.message);
    return false;
  } finally { client.release(); }
}

async function pendingCount() {
  const r = await pool.query(`SELECT (SELECT COUNT(*) FROM ads WHERE status = 'pending')::int + (SELECT COUNT(*) FROM ad_topups WHERE status = 'pending')::int AS c`);
  return r.rows[0].c;
}

module.exports = {
  cfg, KINDS, UNITS, KIND_LABEL, CATEGORIES, PLACEMENTS, METHODS,
  priceFor, rs, DAY_SQL, oneLine, multiLine, cleanLink, cleanPhone,
  placeOf, bannerFor, feedAdFor, recordViews, recordClick, pendingCount, isOwner,
};
