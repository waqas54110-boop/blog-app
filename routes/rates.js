// Daily Rates (V45): /rates, /rates/dollar-rate-today, /rates/gold-rate-today, /rates/petrol-price-today,
// /rates/prayer-times/<city>, share cards /og/rates/<name>.png, aur admin /admin/rates (petrol/diesel haath se).
const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const card = require('../lib/card');
const R = require('../lib/rates');
const indexnow = require('../lib/indexnow');

const router = express.Router();
const baseUrlOf = (req) => config.siteUrl || `${req.protocol}://${req.get('host')}`;

const requireAdmin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    return res.status(403).render('404', { code: 403, title: 'Not allowed', message: 'Only the blog owner can do this.' });
  }
  next();
};

// ---------- formatting ----------
const grp = (n, d = 0) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
const rs = (n, d = 0) => (Number.isFinite(n) ? 'Rs ' + grp(n, d) : '-');
const dateText = (d = new Date()) => d.toLocaleDateString('en-GB', { timeZone: R.TZ, day: 'numeric', month: 'long', year: 'numeric' });
const timeText = (d) => new Date(d).toLocaleString('en-GB', { timeZone: R.TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const dayShort = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const to12h = (t) => { const [h, m] = String(t).split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
// change vs pichla record: { diff, pct, dir: up|down|flat }
const change = (cur, prev) => {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null;
  const diff = cur - prev;
  return { diff, pct: (diff / prev) * 100, dir: Math.abs(diff) < 1e-9 ? 'flat' : diff > 0 ? 'up' : 'down' };
};
const chip = (ch, d = 0) => {
  if (!ch) return '';
  if (ch.dir === 'flat') return '<span class="rt-ch rt-flat">no change</span>';
  return `<span class="rt-ch rt-${ch.dir}">${ch.dir === 'up' ? '&#9650;' : '&#9660;'} ${grp(Math.abs(ch.diff), d)} (${Math.abs(ch.pct).toFixed(2)}%)</span>`;
};
const F = { grp, rs, dateText, timeText, dayShort, to12h, change, chip };

const NAV = [
  ['/rates', 'All rates'], ['/rates/dollar-rate-today', 'Dollar'], ['/rates/gold-rate-today', 'Gold & Silver'],
  ['/rates/petrol-price-today', 'Petrol & Diesel'], ['/rates/prayer-times/lahore', 'Namaz timings'],
];

function page(req, res, view, { name, title, description, path, extra = {} }) {
  const base = baseUrlOf(req);
  const url = base + path;
  const v = crypto.createHash('md5').update(title).digest('hex').slice(0, 8);
  res.render(view, {
    title,
    metaDescription: description,
    ogUrl: url,
    ogType: 'website',
    ogImage: card.isAvailable() ? `${base}/og/rates/${name}.png?v=${v}` : null,
    jsonLd: [{
      '@context': 'https://schema.org', '@type': 'WebPage', name: title, description, url,
      inLanguage: 'en', dateModified: new Date().toISOString(),
      isPartOf: { '@type': 'WebSite', name: config.siteName, url: base },
    }],
    NAV, F, path, url,
    shareFb: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url + '?utm_source=facebook&utm_medium=share')}`,
    shareWa: `https://wa.me/?text=${encodeURIComponent(title + ' ' + url + '?utm_source=whatsapp&utm_medium=share')}`,
    ...extra,
  });
}

// DB table (migration_v45) na ho to page girne ke bajaye saaf message
const safe = (handler) => async (req, res, next) => {
  try { await handler(req, res, next); } catch (err) {
    if (err.code === '42P01') {
      return res.status(503).render('404', { code: 503, title: 'Rates are being set up', message: 'The rates tables are not ready yet (run migration_v45.sql).' });
    }
    console.error('[rates]', err);
    res.status(500).send('Server error');
  }
};

const KEYS = ['usd_pkr', 'sar_pkr', 'aed_pkr', 'gbp_pkr', 'eur_pkr', 'xau_usd', 'xag_usd', 'petrol', 'diesel', 'kerosene', 'ldo', 'gold_premium'];

// ---------- snapshot: sab pages isi se banate hain ----------
async function snapshot() {
  const L = await R.latest(KEYS);
  const premium = L.gold_premium ? L.gold_premium.value : 0;
  const usd = L.usd_pkr;
  const gold = L.xau_usd && usd ? R.goldPrices(L.xau_usd.value, usd.value, premium) : null;
  const goldPrev = L.xau_usd && usd && L.xau_usd.prev && usd.prev ? R.goldPrices(L.xau_usd.prev, usd.prev, premium) : null;
  const silver = L.xag_usd && usd ? R.silverPrices(L.xag_usd.value, usd.value) : null;
  const silverPrev = L.xag_usd && usd && L.xag_usd.prev && usd.prev ? R.silverPrices(L.xag_usd.prev, usd.prev) : null;
  const updatedAt = [usd, L.xau_usd].filter(Boolean).map((x) => new Date(x.updatedAt).getTime()).sort((a, b) => b - a)[0] || null;
  return { L, usd, gold, goldChange: gold && goldPrev ? change(gold.tola24, goldPrev.tola24) : null, silver,
    silverChange: silver && silverPrev ? change(silver.tola, silverPrev.tola) : null, updatedAt };
}

// ---------- HUB ----------
router.get('/rates', safe(async (req, res) => {
  const S = await snapshot();
  const t = `Today's Rates in Pakistan (${dateText()}): Dollar, Gold, Petrol & Namaz Timings`;
  const bits = [];
  if (S.usd) bits.push(`USD to PKR ${grp(S.usd.value, 2)}`);
  if (S.gold) bits.push(`24K gold Rs ${grp(S.gold.tola24)} per tola`);
  if (S.L.petrol) bits.push(`petrol Rs ${grp(S.L.petrol.value, 2)}/litre`);
  page(req, res, 'rates', {
    name: 'hub', title: t, path: '/rates',
    description: (bits.length ? bits.join(', ') + '. ' : '') + 'Updated every day: dollar rate, gold and silver price, petrol and diesel price and namaz timings for Pakistan.',
    extra: { S, active: '/rates' },
  });
}));

// ---------- DOLLAR ----------
router.get('/rates/dollar-rate-today', safe(async (req, res) => {
  const S = await snapshot();
  const hist = await R.history(['usd_pkr', 'sar_pkr', 'aed_pkr', 'gbp_pkr', 'eur_pkr'], 14);
  const v = S.usd ? grp(S.usd.value, 2) : '';
  page(req, res, 'rates-dollar', {
    name: 'dollar',
    title: `Dollar Rate in Pakistan Today (${dateText()})${v ? ': USD to PKR ' + v : ''}`,
    path: '/rates/dollar-rate-today',
    description: S.usd
      ? `Today's USD to PKR rate is Rs ${v}. Also see Saudi Riyal, UAE Dirham, Pound and Euro rates in Pakistani rupees, with a currency converter and the last 14 days history.`
      : 'USD to PKR rate today with Saudi Riyal, UAE Dirham, Pound and Euro rates, a currency converter and the last 14 days history.',
    extra: { S, hist, active: '/rates/dollar-rate-today', currencies: R.CURRENCIES },
  });
}));

// ---------- GOLD ----------
router.get('/rates/gold-rate-today', safe(async (req, res) => {
  const S = await snapshot();
  const hist = await R.history(['xau_usd', 'usd_pkr', 'gold_premium'], 14);
  const L2 = await R.latest(['gold_premium']);
  const premium = L2.gold_premium ? L2.gold_premium.value : 0;
  const rows = hist.filter((h) => h.xau_usd && h.usd_pkr).map((h) => ({ day: h.day, tola: R.goldPrices(h.xau_usd, h.usd_pkr, premium).tola24 }));
  rows.forEach((r, i) => { r.ch = rows[i + 1] ? change(r.tola, rows[i + 1].tola) : null; });
  page(req, res, 'rates-gold', {
    name: 'gold',
    title: `Gold Rate in Pakistan Today (${dateText()})${S.gold ? ': 24K Gold Rs ' + grp(S.gold.tola24) + ' per Tola' : ''}`,
    path: '/rates/gold-rate-today',
    description: S.gold
      ? `Today's 24K gold price in Pakistan is Rs ${grp(S.gold.tola24)} per tola (Rs ${grp(S.gold.rows[0].g10)} per 10 grams). See 22K, 21K and 18K gold and silver rates with the last 14 days history.`
      : 'Gold rate in Pakistan today: 24K, 22K, 21K and 18K per tola and per 10 grams, silver price and the last 14 days history.',
    extra: { S, rows, active: '/rates/gold-rate-today' },
  });
}));

// ---------- PETROL ----------
router.get('/rates/petrol-price-today', safe(async (req, res) => {
  const S = await snapshot();
  const hist = await R.history(['petrol', 'diesel'], 120);
  // sirf wo din jab qeemat badli
  const changes = hist.filter((h, i) => {
    const next = hist[i + 1];
    return !next || next.petrol !== h.petrol || next.diesel !== h.diesel;
  }).slice(0, 10);
  const p = S.L.petrol;
  page(req, res, 'rates-petrol', {
    name: 'petrol',
    title: `Petrol Price in Pakistan Today (${dateText()})${p ? ': Rs ' + grp(p.value, 2) + ' per Litre' : ''}`,
    path: '/rates/petrol-price-today',
    description: p
      ? `Petrol price in Pakistan is Rs ${grp(p.value, 2)} per litre${S.L.diesel ? ' and high speed diesel is Rs ' + grp(S.L.diesel.value, 2) : ''} (effective ${dayShort(p.day)}). See the latest change and price history.`
      : 'Latest petrol and diesel prices in Pakistan per litre, effective date and price history.',
    extra: { S, changes, fuels: R.FUELS, active: '/rates/petrol-price-today' },
  });
}));

// ---------- NAMAZ ----------
router.get('/rates/prayer-times{/:city}', safe(async (req, res) => {
  const key = String(req.params.city || 'lahore').toLowerCase();
  if (!R.CITIES[key]) return res.status(404).render('404', { title: 'Not Found' });
  const data = await R.prayerTimes(key);
  const city = R.CITIES[key];
  page(req, res, 'rates-prayer', {
    name: 'prayer',
    title: `Namaz Timings in ${city} Today (${dateText()}): Fajr, Dhuhr, Asr, Maghrib, Isha`,
    path: '/rates/prayer-times/' + key,
    description: data
      ? `Prayer times in ${city} today: Fajr ${to12h(data.times[0][1])}, Dhuhr ${to12h(data.times[2][1])}, Asr ${to12h(data.times[3][1])}, Maghrib ${to12h(data.times[4][1])}, Isha ${to12h(data.times[5][1])}.`
      : `Namaz timings in ${city} today: Fajr, Dhuhr, Asr, Maghrib and Isha.`,
    extra: { data, city, cityKey: key, cities: R.CITIES, active: '/rates/prayer-times/lahore' },
  });
}));

// ---------- Share cards ----------
router.get('/og/rates/:name.png', async (req, res) => {
  if (!card.isAvailable()) return res.status(404).end();
  try {
    let S = null;
    try { S = await snapshot(); } catch (e) { /* table na ho to generic card */ }
    const d = dateText();
    let title = `Today's Rates in Pakistan: dollar, gold, petrol`;
    let category = 'Rates';
    switch (req.params.name) {
      case 'dollar': category = 'Dollar Rate Today'; title = S && S.usd ? `USD to PKR: Rs ${grp(S.usd.value, 2)}` : 'Dollar rate in Pakistan today'; break;
      case 'gold': category = 'Gold Rate Today'; title = S && S.gold ? `24K Gold: Rs ${grp(S.gold.tola24)} per tola` : 'Gold rate in Pakistan today'; break;
      case 'petrol': category = 'Petrol Price Today'; title = S && S.L.petrol ? `Petrol: Rs ${grp(S.L.petrol.value, 2)} per litre` : 'Petrol price in Pakistan today'; break;
      case 'prayer': category = 'Namaz Timings'; title = 'Namaz timings today for all major cities of Pakistan'; break;
      case 'hub': break;
      default: return res.status(404).end();
    }
    const png = await card.renderCard({ title, category, siteName: config.siteName, meta: d });
    res.set('Cache-Control', 'public, max-age=600');
    res.type('image/png').send(png);
  } catch (err) {
    console.error('[rates card]', err.message);
    res.status(404).end();
  }
});

// ---------- Admin ----------
router.get('/admin/rates', requireAdmin, safe(async (req, res) => {
  const L = await R.latest(['petrol', 'diesel', 'kerosene', 'ldo', 'gold_premium', 'usd_pkr', 'xau_usd']);
  res.render('admin-rates', { title: 'Manage rates', L, F, fuels: R.FUELS, today: R.pkDate(), flash: req.query.ok || null, err: req.query.err || null, robots: 'noindex,nofollow' });
}));

const cleanNum = (v, lo, hi) => {
  const s = String(v || '').replace(/,/g, '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : NaN;
};

router.post('/admin/rates', requireAdmin, safe(async (req, res) => {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(req.body.day || '') ? req.body.day : null;
  let saved = 0;
  for (const [key] of R.FUELS) {
    const n = cleanNum(req.body[key], 1, 2000);
    if (Number.isNaN(n)) return res.redirect('/admin/rates?err=' + encodeURIComponent(`"${key}" is not a valid price.`));
    if (n !== null) { await R.save(key, n, 'manual', day); saved++; }
  }
  const prem = cleanNum(req.body.gold_premium, -500000, 500000);
  if (Number.isNaN(prem)) return res.redirect('/admin/rates?err=' + encodeURIComponent('Gold adjustment is not valid.'));
  if (prem !== null) { await R.save('gold_premium', prem, 'manual', day); saved++; }

  if (saved && config.siteUrl) {
    indexnow.ping(['/rates', '/rates/petrol-price-today', '/rates/gold-rate-today'].map((p) => config.siteUrl + p), { throttle: true }).catch(() => {});
  }
  res.redirect('/admin/rates?ok=' + encodeURIComponent(saved ? `Saved ${saved} value(s).` : 'Nothing to save.'));
}));

router.post('/admin/rates/refresh', requireAdmin, safe(async (req, res) => {
  const r = await R.refresh(true);
  res.redirect('/admin/rates?ok=' + encodeURIComponent(r.saved ? `Updated: ${r.saved.join(', ') || 'nothing came back'}` : 'Refresh failed, see server logs.'));
}));

module.exports = router;
