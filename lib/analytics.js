const pool = require('../db');
const { visitorId, geoCountry, ageGroup, clientIp, geoCity } = require('./demographics');

const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegrambot|headless|curl|wget|python-requests/i;

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

async function trackVisit(req, res, postId) {
  try {
    if (isBot(req)) return;
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
    try {
      // user_agent (migration_v53) pehle; na ho to ip + city wali purani query neeche
      await pool.query(
        `INSERT INTO post_visits (post_id, source, medium, referrer, visitor, user_id, country, gender, age_group, campaign, ip, city, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [...cols, campaign, ip, city, cleanUA(req)]
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

const isBot = (req) => BOT_RE.test(req.get('User-Agent') || '');

// Raw User-Agent (300 char tak) jo DB mein jata hai
const cleanUA = (req) => String(req.get('User-Agent') || '').replace(/[\u0000-\u001f]/g, '').slice(0, 300) || null;

// Raw User-Agent -> chhota label, jaise "Chrome - Android" (admin table mein dikhane ke liye)
function uaLabel(ua) {
  ua = String(ua || '');
  if (!ua) return '-';
  let browser = 'Other';
  if (/musical_ly|tiktok|bytedancewebview/i.test(ua)) browser = 'TikTok app';
  else if (/FBAN|FBAV|FB_IAB/i.test(ua)) browser = 'Facebook app';
  else if (/Instagram/i.test(ua)) browser = 'Instagram app';
  else if (/WhatsApp/i.test(ua)) browser = 'WhatsApp';
  else if (/Edg(e|A|iOS)?\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser/i.test(ua)) browser = 'Samsung Browser';
  else if (/Firefox|FxiOS/i.test(ua)) browser = 'Firefox';
  else if (/CriOS|Chrome\//i.test(ua)) browser = /; wv\)/i.test(ua) ? 'Android WebView' : 'Chrome';
  else if (/Safari\//i.test(ua)) browser = 'Safari';
  let os = '';
  if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/CrOS/i.test(ua)) os = 'ChromeOS';
  else if (/Linux/i.test(ua)) os = 'Linux';
  return os ? `${browser} - ${os}` : browser;
}

module.exports = { trackVisit, detectSource, isBot, cleanUA, uaLabel };
