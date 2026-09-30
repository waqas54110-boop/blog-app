// Vote contest ki share-card (1200x630): title, dono ki photo, VS. WhatsApp/Facebook par link ke sath dikhti hai.
const pool = require('../db');
const card = require('./card');

async function loadPhoto(sharp, url) {
  const m = /^\/img\/(\d{1,9})$/.exec(url || '');
  if (!m) return null;
  try {
    const r = await pool.query('SELECT data FROM images WHERE id = $1', [parseInt(m[1], 10)]);
    if (!r.rows[0]) return null;
    const mask = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="470" height="340"><rect width="470" height="340" rx="24" ry="24"/></svg>');
    return await sharp(r.rows[0].data)
      .resize(470, 340, { fit: 'cover', position: 'attention' })
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer();
  } catch (err) {
    console.error('[votecard] photo:', err.message);
    return null;
  }
}

function svg(poll, siteName) {
  const { wrap, esc } = card;
  const W = 1200, H = 630, AX = 60, BX = 670, TOP = 150;
  const title = wrap(poll.title, 44, 1080, 2);
  const titleSvg = title.map((l, i) =>
    `<text x="600" y="${62 + i * 54}" font-size="44" fill="#fff" text-anchor="middle">${esc(l)}</text>`).join('');
  const nm = (s) => esc(wrap(s, 34, 460, 1)[0] || '');
  const frame = (x) => `<rect x="${x - 6}" y="${TOP - 6}" width="482" height="352" rx="30" ry="30" fill="#fff" fill-opacity="0.9"/>
    <rect x="${x}" y="${TOP}" width="470" height="340" rx="24" ry="24" fill="#312e81"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <circle cx="1120" cy="60" r="200" fill="#fff" fill-opacity="0.07"/><circle cx="60" cy="620" r="150" fill="#fff" fill-opacity="0.06"/>
  <g font-family="DejaVu Sans" font-weight="bold">
    ${titleSvg}
    ${frame(AX)}${frame(BX)}
    <circle cx="600" cy="${TOP + 170}" r="58" fill="#f43f5e" stroke="#fff" stroke-width="6"/>
    <text x="600" y="${TOP + 190}" font-size="52" fill="#fff" text-anchor="middle">VS</text>
    <text x="${AX + 235}" y="548" font-size="34" fill="#fff" text-anchor="middle">${nm(poll.a_name)}</text>
    <text x="${BX + 235}" y="548" font-size="34" fill="#fff" text-anchor="middle">${nm(poll.b_name)}</text>
    <text x="600" y="605" font-size="24" fill="#fff" fill-opacity="0.85" text-anchor="middle">🗳 Vote now · ${esc(siteName)}</text>
  </g>
</svg>`.replace('🗳 ', '');
}

async function renderVoteCard(poll, siteName) {
  if (!card.isAvailable()) throw new Error('sharp not available');
  const sharp = require('sharp');
  const key = ['vote', poll.id, poll.title, poll.a_name, poll.b_name, poll.a_image, poll.b_image, siteName].join('|');
  return card.cached(key, async () => {
    const [a, b] = await Promise.all([loadPhoto(sharp, poll.a_image), loadPhoto(sharp, poll.b_image)]);
    const layers = [];
    if (a) layers.push({ input: a, left: 60, top: 150 });
    if (b) layers.push({ input: b, left: 670, top: 150 });
    return sharp(Buffer.from(svg(poll, siteName))).composite(layers).png({ palette: true, quality: 92, effort: 4 }).toBuffer();
  });
}

module.exports = { renderVoteCard };
