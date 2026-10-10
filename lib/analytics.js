const pool = require('../db');
const { visitorId, geoCountry, ageGroup, clientIp, geoCity, readCookie } = require('./demographics');
const { parseUA, isBotUA, botInfo } = require('./ua');
const ipinfo = require('./ipinfo');

const SOURCE_HOSTS = [
  ['whatsapp', /(^|\.)whatsapp\.com$|^wa\.me$/],
  ['facebook', /(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)fb\.me$|^l\.facebook\.com$|(^|\.)messenger\.com$/],
  ['instagram', /(^|\.)instagram\.com$/],
  ['twitter', /(^|\.)twitter\.com$|^t\.co$|(^|\.)x\.com$/],
  ['google', /(^|\.)google\.[a-z.]+$/],
  ['bing', /(^|\.)bing\.com$/],
  ['youtube', /(^|\.)youtube\.com$|^youtu\.be$/],
  ['linkedin', /(^|\.)linkedin\.com$|^lnkd\.in$/],
  ['telegram', /(^|\.)telegram\.org$|^t\.me$/],
  ['tiktok', /(^|\.)tiktok\.com$|(^|\.)tiktokv\.com$|^vm\.tiktok\.com$/],
];

// TikTok ka in-app browser aksar Referer nahi bhejta, is liye User-Agent se bhi pehchante hain
const TIKTOK_UA = /musical_ly|tiktok|bytedancewebview|trill_/i;

const clean = (v, n = 40) =>
  String(v || '').toLowerCase().replace(/[^a-z0-9_\-.]/g, '').slice(0, n);

// utm_source pehle, phir Referer header, warna direct.
function detectSource(req) {
  const utm = clean(req.query.utm_source);
  const medium = clean(req.query.utm_medium) || null;
  const campaign = clean(req.query.utm_campaign, 60) || null; // group poster: har group ka alag naam
  const ref = req.get('Referer') || '';
  let refHost = '';
  try { refHost = new URL(ref).hostname; } catch (e) { /* no referer */ }

  if (utm) return { source: utm, medium, campaign, referrer: refHost || null };
  if (TIKTOK_UA.test(req.get('User-Agent') || '') && refHost !== req.hostname) {
    return { source: 'tiktok', medium: 'inapp', campaign: null, referrer: refHost || null };
  }
  if (refHost) {
    if (refHost === req.hostname) return { source: 'internal', medium: null, campaign: null, referrer: refHost };
    const hit = SOURCE_HOSTS.find(([, re]) => re.test(refHost));
    return { source: hit ? hit[0] : 'other', medium: null, campaign: null, referrer: refHost.slice(0, 255) };
  }
  return { source: 'direct', medium: null, campaign: null, referrer: null };
}

// Admin ne /analytics par "Is browser ko ignore karo" dabaya ho to cookie kz_ign=1: us browser ke visits ginti mein nahi
const isIgnored = (req) => readCookie(req, 'kz_ign') === '1';

async function trackVisit(req, res, postId) {
  try {
    if (isBot(req) || isIgnored(req)) return;
    const { source, medium, campaign, referrer } = detectSource(req);
    const vid = visitorId(req, res); // sync: cookie render se pehle set ho jaye
    const uid = req.session && req.session.user ? req.session.user.id : null;

    let gender = null, group = null, profileCountry = null;
    if (uid) {
      try {
        const u = (await pool.query('SELECT birth_year, gender, country FROM users WHERE id = $1', [uid])).rows[0];
        if (u) { gender = u.gender; group = ageGroup(u.birth_year); profileCountry = u.country; }
      } catch (e) { /* migration_v23 na chali ho */ }
    }
    const country = geoCountry(req) || profileCountry || null;

    const cols = [postId, source, medium, referrer, vid, uid, country, gender, group];
    const ip = clientIp(req);
    const city = geoCity(req);
    const d = parseUA(req.get('User-Agent'));
    if (ip) ipinfo.enqueue(ip); // ISP / VPN background mein (migration_v55)
    try {
      // device / browser (migration_v55) pehle; na ho to neeche purani tarah
      await pool.query(
        `INSERT INTO post_visits (post_id, source, medium, referrer, visitor, user_id, country, gender, age_group, campaign, ip, city, device, os, browser, brand, inapp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [...cols, campaign, ip, city, d.device, d.os, d.browser, d.brand, d.inapp]
      );
      return;
    } catch (err) {
      if (err.code !== '42703') throw err;
    }
    try {
      // ip + city (migration_v50) pehle; na ho to purani tarah neeche
      await pool.query(
        `INSERT INTO post_visits (post_id, source, medium, referrer, visitor, user_id, country, gender, age_group, campaign, ip, city)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [...cols, campaign, ip, city]
      );
      return;
    } catch (err) {
      if (err.code !== '42703') throw err;
    }
    try {
      // campaign column (migration_v42) pehle; na ho to uske bina (purani tarah) visit ginein
      await pool.query(
        `INSERT INTO post_visits (post_id, source, medium, referrer, visitor, user_id, country, gender, age_group, campaign)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [...cols, campaign]
      );
    } catch (err) {
      if (err.code !== '42703') throw err;
      try {
        await pool.query(
          `INSERT INTO post_visits (post_id, source, medium, referrer, visitor, user_id, country, gender, age_group)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          cols
        );
      } catch (err2) {
        if (err2.code !== '42703') throw err2; // migration_v23 bhi baaqi
        await pool.query(
          'INSERT INTO post_visits (post_id, source, medium, referrer) VALUES ($1, $2, $3, $4)',
          [postId, source, medium, referrer]
        );
      }
    }
  } catch (err) {
    console.error('[analytics] fail:', err.message);
  }
}

const isBot = (req) => isBotUA(req.get('User-Agent'));

// Bot ka visit alag table (bot_visits) mein. Insani numbers mein kabhi nahi jata.
// Fire-and-forget: page ko slow nahi karta, aur migration_v55 na chali ho to chupchap chhod deta hai.
let lastPrune = 0;
function logBot(req, path) {
  try {
    const ua = req.get('User-Agent') || '';
    const { bot, kind } = botInfo(ua);
    const p = String(path || req.originalUrl || req.path || '').split('?')[0].slice(0, 255);
    pool.query(
      'INSERT INTO bot_visits (bot, kind, path, ip, country, ua) VALUES ($1, $2, $3, $4, $5, $6)',
      [bot, kind, p, clientIp(req), geoCountry(req), ua.slice(0, 200)]
    ).catch((err) => { if (err.code !== '42P01') console.error('[bots] log:', err.message); });
    // 90 din se purane bot rows saaf (din mein ek baar)
    if (Date.now() - lastPrune > 86400000) {
      lastPrune = Date.now();
      pool.query("DELETE FROM bot_visits WHERE created_at < now() - interval '90 days'").catch(() => {});
    }
  } catch (err) { /* analytics kabhi page nahi roke */ }
}

module.exports = { trackVisit, detectSource, isBot, logBot, isIgnored };
