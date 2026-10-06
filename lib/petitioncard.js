// Petition ki share-card (1200x630). Emoji PNG mein nahi, sirf text.
const pool = require('../db');
const card = require('./card');
const { loadImageBuffer } = require('./cloudinary');
const PT = require('./petitions');

const GREEN = '#0a6b4d', GOLD = '#f2c14e';

async function loadPhoto(sharp, imageId, w, h) {
  if (!imageId) return null;
  try {
    const row = await pool.query('SELECT data, remote_url FROM images WHERE id = $1', [imageId]);
    if (!row.rows[0]) return null;
    const src = await loadImageBuffer(row.rows[0]);
    if (!src) return null;
    return await sharp(src).resize(w, h, { fit: 'cover', position: 'attention' }).png().toBuffer();
  } catch (err) {
    console.error('[petitioncard] photo:', err.message);
    return null;
  }
}

function svg(p, siteName, hasPhoto) {
  const { wrap, esc } = card;
  const PW = 480;
  const X = PW + 56, W = 1200 - X - 48;
  const n = p.sign_count;
  const goal = PT.nextGoal(n);
  const pct = Math.max(2, Math.min(100, Math.round((n * 100) / goal)));
  const title = wrap(p.title, 42, W, 4);
  const titleSvg = title.map((l, i) => `<text x="${X}" y="${150 + i * 52}" font-size="42" fill="#fff">${esc(l)}</text>`).join('');
  const ty = 150 + title.length * 52;
  const where = wrap([p.area, p.city].filter(Boolean).join(', '), 26, W, 1)[0] || '';
  const m = PT.reached(n);
  const bt = `${m} signatures reached`;
  const badge = m >= PT.ADMIN_POST_FROM
    ? `<rect x="${X}" y="40" width="${Math.min(W, Math.round(card.textW(bt, 24)) + 44)}" height="44" rx="22" fill="${GOLD}"/>
       <text x="${X + 22}" y="71" font-size="24" fill="#2b2100">${bt}</text>`
    : `<text x="${X}" y="68" font-size="24" fill="${GOLD}">${esc(p.category)} petition</text>`;
  const resolved = p.status === 'resolved'
    ? `<rect x="${X}" y="${ty + 10}" width="190" height="40" rx="20" fill="${GOLD}"/><text x="${X + 24}" y="${ty + 38}" font-size="22" fill="#2b2100">Victory! Resolved</text>` : '';
  const left = hasPhoto ? '' : `<rect x="0" y="0" width="${PW}" height="630" fill="#0d5a41"/>
    <circle cx="${PW / 2}" cy="300" r="170" fill="#fff" fill-opacity="0.08"/>
    <text x="${PW / 2}" y="${300}" font-size="${p.city.length > 9 ? 56 : 72}" fill="#fff" text-anchor="middle">${esc(wrap(p.city, p.city.length > 9 ? 56 : 72, PW - 60, 1)[0] || '')}</text>
    <text x="${PW / 2}" y="352" font-size="26" fill="#fff" fill-opacity="0.8" text-anchor="middle">needs your signature</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${GREEN}"/>
  ${left}
  <rect x="${PW}" y="0" width="${1200 - PW}" height="630" fill="${GREEN}"/>
  <rect x="${PW}" y="0" width="10" height="630" fill="${GOLD}"/>
  <g font-family="DejaVu Sans" font-weight="bold">
    ${badge}
    ${titleSvg}
    ${resolved}
    <text x="${X}" y="${ty + 70 + (resolved ? 40 : 0)}" font-size="26" fill="#fff" fill-opacity="0.85">${esc(where)}</text>
    <text x="${X}" y="520" font-size="86" fill="#fff">${n}</text>
    <text x="${X + 24 + Math.max(2, String(n).length) * 52}" y="518" font-size="28" fill="#fff" fill-opacity="0.85">signature${n === 1 ? '' : 's'}</text>
    <rect x="${X}" y="540" width="${W}" height="16" rx="8" fill="#fff" fill-opacity="0.2"/>
    <rect x="${X}" y="540" width="${Math.max(16, Math.round((W * pct) / 100))}" height="16" rx="8" fill="${GOLD}"/>
    <text x="${X}" y="598" font-size="22" fill="#fff" fill-opacity="0.8">Goal ${goal} - Sign at ${esc(siteName)}</text>
  </g>
</svg>`;
}

async function renderPetitionCard(p, siteName) {
  if (!card.isAvailable()) throw new Error('sharp not available');
  const sharp = require('sharp');
  const key = ['petition', p.id, p.title, p.city, p.area || '', p.category, p.status, p.sign_count, p.image_id || 0, siteName].join('|');
  return card.cached(key, async () => {
    const photo = await loadPhoto(sharp, p.image_id, 480, 630);
    const base = sharp(Buffer.from(svg(p, siteName, !!photo)));
    return (photo ? base.composite([{ input: photo, left: 0, top: 0 }]) : base).png({ palette: true, quality: 92, effort: 4 }).toBuffer();
  });
}

module.exports = { renderPetitionCard };
