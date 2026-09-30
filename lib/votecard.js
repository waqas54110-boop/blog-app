// Vote contest ki share-cards (1200x630):
//  1) renderVoteCard: title + sab options ki photo (2 ho to VS). Link ke sath WhatsApp/Facebook par dikhti hai.
//  2) renderVotedCard: "I voted for X" + abhi ka result (62% / 38%). Vote dene wala ye card share karta hai.
// Emoji in PNG mein nahi (font mein nahi hote), sirf text.
const pool = require('../db');
const card = require('./card');

async function loadPhoto(sharp, url, w, h, r) {
  const m = /^\/img\/(\d{1,9})$/.exec(url || '');
  if (!m) return null;
  try {
    const row = await pool.query('SELECT data FROM images WHERE id = $1', [parseInt(m[1], 10)]);
    if (!row.rows[0]) return null;
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" ry="${r}"/></svg>`);
    return await sharp(row.rows[0].data)
      .resize(w, h, { fit: 'cover', position: 'attention' })
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer();
  } catch (err) {
    console.error('[votecard] photo:', err.message);
    return null;
  }
}

const BG = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#g)"/>
  <circle cx="1120" cy="60" r="200" fill="#fff" fill-opacity="0.07"/><circle cx="60" cy="620" r="150" fill="#fff" fill-opacity="0.06"/>`;

// n options ke liye tiles ki jagah (x, y, w, h) aur naam ka font
function layout(n) {
  const GAP = n === 2 ? 140 : 30, LEFT = 60, WIDTH = 1080; // 2 options: beech mein VS ke liye chauri jagah
  const rows = n > 4 ? 2 : 1;
  const cols = rows === 1 ? n : Math.ceil(n / 2);
  const w = Math.floor((WIDTH - GAP * (cols - 1)) / cols);
  const h = rows === 2 ? 160 : n <= 3 ? 340 : 290;
  const nameSize = n === 2 ? 34 : n === 3 ? 30 : rows === 2 ? 22 : 26;
  const nameH = nameSize + 16;
  const top = rows === 2 ? 144 : 150 + Math.max(0, Math.floor((360 - h - nameH) / 2));
  const tiles = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const inRow = r === rows - 1 ? n - cols * (rows - 1) : cols;
    const rowW = inRow * w + GAP * (inRow - 1);
    const x0 = LEFT + Math.floor((WIDTH - rowW) / 2);
    tiles.push({ x: x0 + (i - r * cols) * (w + GAP), y: top + r * (h + nameH + 22), w, h });
  }
  return { tiles, nameSize, radius: rows === 2 ? 16 : 24 };
}

function voteSvg(poll, options, siteName) {
  const { wrap, esc } = card;
  const n = options.length;
  const L = layout(n);
  const title = wrap(poll.title, 44, 1080, 2);
  const titleSvg = title.map((l, i) =>
    `<text x="600" y="${62 + i * 54}" font-size="44" fill="#fff" text-anchor="middle">${esc(l)}</text>`).join('');
  const pad = 6;
  const tiles = L.tiles.map((t, i) => {
    const nm = esc(wrap(options[i].name, L.nameSize, t.w - 10, 1)[0] || '');
    return `<rect x="${t.x - pad}" y="${t.y - pad}" width="${t.w + pad * 2}" height="${t.h + pad * 2}" rx="${L.radius + 6}" ry="${L.radius + 6}" fill="#fff" fill-opacity="0.9"/>
    <rect x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" rx="${L.radius}" ry="${L.radius}" fill="#312e81"/>
    <text x="${t.x + t.w / 2}" y="${t.y + t.h + L.nameSize + 12}" font-size="${L.nameSize}" fill="#fff" text-anchor="middle">${nm}</text>`;
  }).join('');
  const vs = n === 2
    ? `<circle cx="600" cy="${L.tiles[0].y + L.tiles[0].h / 2}" r="58" fill="#f43f5e" stroke="#fff" stroke-width="6"/>
       <text x="600" y="${L.tiles[0].y + L.tiles[0].h / 2 + 20}" font-size="52" fill="#fff" text-anchor="middle">VS</text>`
    : '';
  const tag = poll.kind === 'knockout' ? `Knockout - ${n} contenders` : 'Vote now';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  ${BG}
  <g font-family="DejaVu Sans" font-weight="bold">
    ${titleSvg}
    ${tiles}
    ${vs}
    <text x="600" y="612" font-size="24" fill="#fff" fill-opacity="0.85" text-anchor="middle">${esc(tag)} · ${esc(siteName)}</text>
  </g>
</svg>`;
}

async function renderVoteCard(poll, options, siteName) {
  if (!card.isAvailable()) throw new Error('sharp not available');
  const sharp = require('sharp');
  const key = ['vote', poll.id, poll.kind, poll.title, siteName, ...options.map((o) => o.name + '~' + o.image)].join('|');
  return card.cached(key, async () => {
    const L = layout(options.length);
    const photos = await Promise.all(options.map((o, i) => loadPhoto(sharp, o.image, L.tiles[i].w, L.tiles[i].h, L.radius)));
    const layers = [];
    photos.forEach((ph, i) => { if (ph) layers.push({ input: ph, left: L.tiles[i].x, top: L.tiles[i].y }); });
    return sharp(Buffer.from(voteSvg(poll, options, siteName))).composite(layers).png({ palette: true, quality: 92, effort: 4 }).toBuffer();
  });
}

// ---------- "I voted for X" card ----------
// options: [{ id, name, image, votes, pct }], pickedId: jis ko vote diya, heading: knockout mein "Semi-final 1"
function votedSvg(poll, options, pickedId, heading, siteName) {
  const { wrap, esc } = card;
  const picked = options.find((o) => o.id === pickedId) || options[0];
  const n = options.length;
  const title = wrap(heading ? `${poll.title} - ${heading}` : poll.title, 34, 1080, 2);
  const titleSvg = title.map((l, i) =>
    `<text x="600" y="${58 + i * 42}" font-size="34" fill="#fff" fill-opacity="0.92" text-anchor="middle">${esc(l)}</text>`).join('');

  const rowH = n <= 2 ? 76 : n <= 4 ? 58 : 46;
  const fs = n <= 2 ? 30 : n <= 4 ? 26 : 22;
  const barH = n <= 2 ? 30 : n <= 4 ? 24 : 18;
  const RX = 520, RW = 620, nameW = n <= 2 ? 300 : 250, barX = RX + nameW + 16, barW = RW - nameW - 16 - 96;
  const nameLines = wrap(picked.name, 48, RW, 2);
  const nameSvg = nameLines.map((l, i) => `<text x="${RX}" y="${248 + i * 54}" font-size="48" fill="#fff">${esc(l)}</text>`).join('');
  const rowsTop = 248 + nameLines.length * 54 + 28;
  const rows = options.map((o, i) => {
    const y = rowsTop + i * rowH;
    const mine = o.id === picked.id;
    const nm = esc(wrap(o.name, fs, nameW, 1)[0] || '');
    const w = Math.max(barH, Math.round((barW * o.pct) / 100));
    return `<text x="${RX}" y="${y + barH - 2}" font-size="${fs}" fill="#fff" fill-opacity="${mine ? 1 : 0.8}">${nm}</text>
    <rect x="${barX}" y="${y}" width="${barW}" height="${barH}" rx="${barH / 2}" fill="#fff" fill-opacity="0.18"/>
    <rect x="${barX}" y="${y}" width="${w}" height="${barH}" rx="${barH / 2}" fill="${mine ? '#fde047' : '#fff'}" fill-opacity="${mine ? 1 : 0.6}"/>
    <text x="${RX + RW}" y="${y + barH - 2}" font-size="${fs}" fill="#fff" text-anchor="end">${o.pct}%</text>`;
  }).join('');
  const total = options.reduce((a, o) => a + o.votes, 0);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  ${BG}
  <g font-family="DejaVu Sans" font-weight="bold">
    ${titleSvg}
    <rect x="54" y="144" width="412" height="412" rx="36" ry="36" fill="#fff" fill-opacity="0.9"/>
    <rect x="60" y="150" width="400" height="400" rx="30" ry="30" fill="#312e81"/>
    <text x="${RX}" y="190" font-size="28" fill="#fde047">I VOTED FOR</text>
    ${nameSvg}
    ${rows}
    <text x="${RX}" y="${Math.min(rowsTop + n * rowH + 14, 560)}" font-size="22" fill="#fff" fill-opacity="0.85">${total} vote${total === 1 ? '' : 's'} so far</text>
    <text x="600" y="612" font-size="24" fill="#fff" fill-opacity="0.85" text-anchor="middle">Cast your vote · ${esc(siteName)}</text>
  </g>
</svg>`;
}

async function renderVotedCard(poll, options, pickedId, heading, siteName) {
  if (!card.isAvailable()) throw new Error('sharp not available');
  const sharp = require('sharp');
  // Key mein votes bhi hain: result badle to nayi card banti hai
  const key = ['voted', poll.id, poll.title, heading || '', pickedId, siteName,
    ...options.map((o) => `${o.id}~${o.name}~${o.image}~${o.votes}`)].join('|');
  return card.cached(key, async () => {
    const picked = options.find((o) => o.id === pickedId) || options[0];
    const photo = await loadPhoto(sharp, picked.image, 400, 400, 30);
    const layers = photo ? [{ input: photo, left: 60, top: 150 }] : [];
    return sharp(Buffer.from(votedSvg(poll, options, picked.id, heading, siteName))).composite(layers)
      .png({ palette: true, quality: 92, effort: 4 }).toBuffer();
  });
}

module.exports = { renderVoteCard, renderVotedCard };
