const pool = require('../db');

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
  const ref = req.get('Referer') || '';
  let refHost = '';
  try { refHost = new URL(ref).hostname; } catch (e) { /* no referer */ }

  if (utm) return { source: utm, medium, referrer: refHost || null };
  if (refHost) {
    if (refHost === req.hostname) return { source: 'internal', medium: null, referrer: refHost };
    const hit = SOURCE_HOSTS.find(([, re]) => re.test(refHost));
    return { source: hit ? hit[0] : 'other', medium: null, referrer: refHost.slice(0, 255) };
  }
  return { source: 'direct', medium: null, referrer: null };
}

async function trackVisit(req, postId) {
  try {
    if (isBot(req)) return;
    const { source, medium, referrer } = detectSource(req);
    await pool.query(
      'INSERT INTO post_visits (post_id, source, medium, referrer) VALUES ($1, $2, $3, $4)',
      [postId, source, medium, referrer]
    );
  } catch (err) {
    console.error('[analytics] fail:', err.message);
  }
}

const isBot = (req) => BOT_RE.test(req.get('User-Agent') || '');

module.exports = { trackVisit, detectSource, isBot };
