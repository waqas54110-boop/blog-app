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

  let catText = String(category || '');
  if (textW(catText, 26) > 560) {
    while (catText.length > 1 && textW(catText + '…', 26) > 560) catText = catText.slice(0, -1);
    catText = catText.replace(/\s+$/, '') + '…';
  }
  const cat = catText ? esc(catText) : '';
  const pillW = Math.round(textW(catText, 26) + 48);
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

// Icon hamesha poora square (iOS / Android khud gol karte hain). maskable: letter chhota, beech ke safe hisse mein
function iconSvg(size, letter, maskable = false) {
  const fs = Math.round(size * (maskable ? 0.38 : 0.58));
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

async function renderIcon(size, letter, maskable = false) {
  if (!load()) throw new Error('sharp not available');
  return cached(`icon|${size}|${letter}|${maskable ? 'm' : ''}`, () => toPng(iconSvg(size, letter, maskable)));
}


// Facebook "hook" card: bara sawal/hairat wala headline + asli numbers (reads, comments) + "Read the full story >>" button.
function hookCardSvg({ hook, category, siteName, stats = [], cta = 'Read the full story' }) {
  const W = 1200, H = 630, PAD = 70, MAXW = W - PAD * 2;
  const len = String(hook).length;
  let size = len <= 30 ? 92 : len <= 55 ? 78 : len <= 85 ? 66 : 54;
  let lines = wrap(hook, size, MAXW, 4);
  while (lines.length > 3 && size > 42) { size -= 6; lines = wrap(hook, size, MAXW, 4); }
  const lineH = Math.round(size * 1.18);
  const blockH = lines.length * lineH;
  const top = Math.round(150 + (330 - blockH) / 2 + size * 0.8);
  const tspans = lines
    .map((l, i) => `<text x="${PAD}" y="${top + i * lineH}" font-size="${size}" fill="#fff">${esc(l)}</text>`)
    .join('');

  let catText = String(category || '').toUpperCase();
  if (textW(catText, 24) > 520) {
    while (catText.length > 1 && textW(catText + '…', 24) > 520) catText = catText.slice(0, -1);
    catText += '…';
  }
  const pillW = Math.round(textW(catText, 24) + 44);
  const pill = catText
    ? `<rect x="${PAD}" y="56" rx="8" ry="8" width="${pillW}" height="46" fill="#ef4444"/>
       <text x="${PAD + 22}" y="89" font-size="24" fill="#fff">${esc(catText)}</text>`
    : '';

  // stats chips (right side of top bar)
  let cx = W - PAD;
  const chips = stats.slice(0, 3).reverse().map((t) => {
    const w = Math.round(textW(t, 24) + 36);
    cx -= w;
    const x = cx; cx -= 12;
    return `<rect x="${x}" y="56" rx="23" ry="23" width="${w}" height="46" fill="#fff" fill-opacity="0.16"/>
            <text x="${x + 18}" y="88" font-size="24" fill="#fff">${esc(t)}</text>`;
  }).join('');

  const ctaW = Math.round(textW(cta + '  >>', 30) + 64);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0f172a"/><stop offset="0.6" stop-color="#1e1b4b"/><stop offset="1" stop-color="#7f1d1d"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <circle cx="1120" cy="560" r="260" fill="#ef4444" fill-opacity="0.12"/>
  <circle cx="80" cy="90" r="200" fill="#6366f1" fill-opacity="0.12"/>
  <rect x="0" y="0" width="14" height="${H}" fill="#ef4444"/>
  <g font-family="DejaVu Sans" font-weight="bold">
    ${pill}
    ${chips}
    ${tspans}
    <text x="${PAD}" y="${H - 48}" font-size="28" fill="#fff" fill-opacity="0.85">${esc(siteName)}</text>
    <rect x="${W - PAD - ctaW}" y="${H - 96}" rx="30" ry="30" width="${ctaW}" height="60" fill="#22c55e"/>
    <text x="${W - PAD - ctaW / 2}" y="${H - 55}" font-size="30" fill="#052e16" text-anchor="middle">${esc(cta)}  &gt;&gt;</text>
  </g>
</svg>`;
}

async function renderHookCard(opts) {
  if (!load()) throw new Error('sharp not available');
  const key = 'hook|' + [opts.hook, opts.category, opts.siteName, (opts.stats || []).join(','), opts.cta].join('|');
  return cached(key, () => toPng(hookCardSvg(opts)));
}

module.exports = { isAvailable, renderCard, renderHookCard, hookCardSvg, renderIcon, cached, wrap, textW, esc, toPng };