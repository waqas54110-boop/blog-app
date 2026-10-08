const pool = require('../db');
const { visitorId, geoCountry, ageGroup } = require('./demographics');

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
];

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

module.exports = { trackVisit, detectSource, isBot };
