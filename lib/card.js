// Share-card image (1200x630 PNG): WhatsApp/Facebook/Twitter par link ke saath dikhti hai.
// `sharp` package chahiye. Agar install/chal na sake to site normal chalti rahegi (sirf card band).
const fs = require('fs');
const os = require('os');
const path = require('path');

let sharp = null;
let loadError = null;

function load() {
  if (sharp || loadError) return sharp;
  try {
    // Server par fonts hon ya na hon, text hamesha dikhe: fontconfig ko sirf bundled font dikhate hain.
    if (!process.env.FONTCONFIG_FILE) {
      const dir = path.join(os.tmpdir(), 'blog-fontconfig');
      fs.mkdirSync(dir, { recursive: true });
      const conf = path.join(dir, 'fonts.conf');
      fs.writeFileSync(
        conf,
        `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n` +
          `  <dir>${path.join(__dirname, '..', 'fonts')}</dir>\n` +
          `  <cachedir>${path.join(dir, 'cache')}</cachedir>\n</fontconfig>\n`
      );
      process.env.FONTCONFIG_FILE = conf;
    }
    sharp = require('sharp');
  } catch (err) {
    loadError = err;
    console.log('[card] sharp load nahi hui, share-card images band hain:', err.message.split('\n')[0]);
  }
  return sharp;
}

const isAvailable = () => !!load();

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// DejaVu Sans Bold ke liye andaza (em ka hissa). Exact nahi, isliye thora margin rakha hai.
function charW(ch) {
  if ('iljI.,:;\'!|'.includes(ch)) return 0.36;
  if (ch === ' ') return 0.35;
  if ('ftr()[]-/\\'.includes(ch)) return 0.46;
  if ('mMWw@%'.includes(ch)) return 0.98;
  if (/[A-Z]/.test(ch)) return 0.78;
  if (/[0-9]/.test(ch)) return 0.7;
  return 0.68;
}
const textW = (s, size) => [...s].reduce((w, ch) => w + charW(ch) * size, 0);

function wrap(text, size, maxW, maxLines) {
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let cur = '';
  for (const word of words) {
    const test = cur ? cur + ' ' + word : word;
    if (textW(test, size) <= maxW) { cur = test; continue; }
    if (cur) lines.push(cur);
    cur = word;
    while (textW(cur, size) > maxW) { // bohot lamba akela lafz
      let cut = cur.length - 1;
      while (cut > 1 && textW(cur.slice(0, cut), size) > maxW) cut--;
      lines.push(cur.slice(0, cut));
      cur = cur.slice(cut);
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 1 && textW(last + '…', size) > maxW) last = last.slice(0, -1);
    kept[maxLines - 1] = last.replace(/[\s.,:;-]+$/, '') + '…';
    return kept;
  }
  return lines;
}

function cardSvg({ title, category, siteName, meta }) {
  const W = 1200, H = 630, PAD = 80, MAXW = W - PAD * 2;
  const len = String(title).length;
  let size = len <= 38 ? 76 : len <= 70 ? 64 : len <= 110 ? 54 : 46;
  let lines = wrap(title, size, MAXW, 4);
  while (lines.length > 3 && size > 40) { size -= 6; lines = wrap(title, size, MAXW, 4); }

  const lineH = Math.round(size * 1.22);
  const blockH = lines.length * lineH;
  const top = Math.max(210, Math.round((H - blockH) / 2) + 20);
  const tspans = lines
    .map((l, i) => `<text x="${PAD}" y="${top + i * lineH}" font-size="${size}" fill="#fff">${esc(l)}</text>`)
    .join('');

  const cat = category ? esc(category) : '';
  const pillW = Math.round(textW(category || '', 26) + 48);
  const pill = category
    ? `<rect x="${PAD}" y="70" rx="24" ry="24" width="${pillW}" height="48" fill="#fff" fill-opacity="0.2"/>
       <text x="${PAD + 24}" y="103" font-size="26" fill="#fff">${cat}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#7c3aed"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <circle cx="1090" cy="80" r="230" fill="#fff" fill-opacity="0.07"/>
  <circle cx="1180" cy="560" r="150" fill="#fff" fill-opacity="0.07"/>
  <circle cx="60" cy="640" r="120" fill="#fff" fill-opacity="0.05"/>
  <g font-family="DejaVu Sans" font-weight="bold">
    ${pill}
    ${tspans}
    <rect x="${PAD}" y="${H - 108}" width="72" height="6" rx="3" fill="#fff" fill-opacity="0.85"/>
    <text x="${PAD}" y="${H - 52}" font-size="30" fill="#fff">${esc(siteName)}</text>
    ${meta ? `<text x="${W - PAD}" y="${H - 52}" font-size="26" fill="#fff" fill-opacity="0.85" text-anchor="end">${esc(meta)}</text>` : ''}
  </g>
</svg>`;
}

function iconSvg(size, letter) {
  const fs = Math.round(size * 0.58);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs>
  <rect width="${size}" height="${size}" fill="url(#g)"/>
  <text x="${size / 2}" y="${size / 2 + fs * 0.36}" font-family="DejaVu Sans" font-weight="bold" font-size="${fs}" fill="#fff" text-anchor="middle">${esc(letter)}</text>
</svg>`;
}

// Chhota cache: har request par dobara image na banani pare
const cache = new Map();
async function cached(key, make) {
  if (cache.has(key)) return cache.get(key);
  const buf = await make();
  cache.set(key, buf);
  if (cache.size > 150) cache.delete(cache.keys().next().value);
  return buf;
}

const toPng = (svg) => sharp(Buffer.from(svg)).png({ palette: true, quality: 92, effort: 4 }).toBuffer();

async function renderCard(opts) {
  if (!load()) throw new Error('sharp not available');
  const key = 'card|' + [opts.title, opts.category, opts.siteName, opts.meta].join('|');
  return cached(key, () => toPng(cardSvg(opts)));
}

async function renderIcon(size, letter) {
  if (!load()) throw new Error('sharp not available');
  return cached(`icon|${size}|${letter}`, () => toPng(iconSvg(size, letter)));
}

module.exports = { isAvailable, renderCard, renderIcon };
