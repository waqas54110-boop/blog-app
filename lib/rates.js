// Daily Rates (V45): dollar / gold / silver (auto), petrol / diesel (admin haath se), namaz timings (auto).
// Har cheez ka roz ka record rates_history table mein jata hai, is liye har page par "pichle 14 din" ki table banti hai.
const pool = require('../db');
const config = require('../config');

const TZ = config.timezone || 'Asia/Karachi';
const TOLA_G = 11.6638038;      // 1 tola = 11.6638038 gram
const OZ_G = 31.1034768;        // 1 troy ounce = 31.1034768 gram
const KARATS = [['24K', 24], ['22K', 22], ['21K', 21], ['18K', 18]];
const CURRENCIES = [['usd', 'US Dollar', 'USD'], ['sar', 'Saudi Riyal', 'SAR'], ['aed', 'UAE Dirham', 'AED'], ['gbp', 'British Pound', 'GBP'], ['eur', 'Euro', 'EUR']];
const FUELS = [['petrol', 'Petrol (per litre)'], ['diesel', 'High Speed Diesel (per litre)'], ['kerosene', 'Kerosene Oil (per litre)'], ['ldo', 'Light Diesel Oil (per litre)']];
const CITIES = {
  lahore: 'Lahore', karachi: 'Karachi', islamabad: 'Islamabad', rawalpindi: 'Rawalpindi', peshawar: 'Peshawar',
  quetta: 'Quetta', faisalabad: 'Faisalabad', multan: 'Multan', hyderabad: 'Hyderabad', sialkot: 'Sialkot',
};

const num = (v) => (typeof v === 'string' ? parseFloat(v) : v);
const ok = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;

async function getJson(url, ms = 9000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { Accept: 'application/json', 'User-Agent': 'KhabzoRates/1.0' } });
  if (!res.ok) throw new Error(`${url.split('/')[2]} HTTP ${res.status}`);
  return res.json();
}

// ---------- Auto fetchers (har ek ke 2 raste; ek band ho to dusra) ----------
async function fetchFx() {
  const out = {};
  try {
    const j = await getJson('https://open.er-api.com/v6/latest/USD');
    const r = j && j.rates;
    if (r && ok(num(r.PKR), 100, 1000)) {
      out.usd_pkr = num(r.PKR);
      for (const [k, , code] of CURRENCIES.slice(1)) if (ok(num(r[code]), 0.0001, 100000)) out[k + '_pkr'] = num(r.PKR) / num(r[code]);
      return out;
    }
  } catch (e) { console.error('[rates] fx primary:', e.message); }
  try {
    const j = await getJson('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json');
    const r = j && j.usd;
    if (r && ok(num(r.pkr), 100, 1000)) {
      out.usd_pkr = num(r.pkr);
      for (const [k] of CURRENCIES.slice(1)) if (ok(num(r[k]), 0.0001, 100000)) out[k + '_pkr'] = num(r.pkr) / num(r[k]);
      return out;
    }
  } catch (e) { console.error('[rates] fx fallback:', e.message); }
  return out;
}

async function fetchMetals() {
  const out = {};
  for (const [sym, key, lo, hi] of [['XAU', 'xau_usd', 500, 30000], ['XAG', 'xag_usd', 5, 1000]]) {
    try {
      const j = await getJson(`https://api.gold-api.com/price/${sym}`);
      if (ok(num(j && j.price), lo, hi)) { out[key] = num(j.price); continue; }
    } catch (e) { console.error(`[rates] ${sym} primary:`, e.message); }
    try { // fallback: 1 USD = x ounce
      const j = await getJson('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json');
      const per = num(j && j.usd && j.usd[sym.toLowerCase()]);
      if (per > 0 && ok(1 / per, lo, hi)) out[key] = 1 / per;
    } catch (e) { console.error(`[rates] ${sym} fallback:`, e.message); }
  }
  return out;
}

// ---------- DB ----------
const todaySql = `(now() AT TIME ZONE '${TZ}')::date`;
async function save(key, value, source = 'auto', day = null) {
  if (!Number.isFinite(value)) return;
  await pool.query(
    `INSERT INTO rates_history (key, day, value, source, updated_at)
     VALUES ($1, COALESCE($3::date, ${todaySql}), $2, $4, now())
     ON CONFLICT (key, day) DO UPDATE SET value = EXCLUDED.value, source = EXCLUDED.source, updated_at = now()`,
    [key, value, day, source]
  );
}

let lastRefresh = 0;
let tableMissingLogged = false;
async function refresh(force = false) {
  if (!force && Date.now() - lastRefresh < 20 * 60 * 1000) return { skipped: true };
  lastRefresh = Date.now();
  try {
    const [fx, metals] = await Promise.all([fetchFx(), fetchMetals()]);
    const all = { ...fx, ...metals };
    for (const [k, v] of Object.entries(all)) await save(k, v, 'auto');
    console.log(`[rates] update: ${Object.keys(all).join(', ') || 'kuch nahi aaya'}`);
    return { saved: Object.keys(all) };
  } catch (err) {
    if (err.code === '42P01') {
      if (!tableMissingLogged) console.log('[rates] migration_v45.sql abhi nahi chali (rates_history table nahi hai).');
      tableMissingLogged = true;
    } else console.error('[rates] refresh:', err.message);
    return { error: err.message };
  }
}

// Har key ki sab se nayi 2 row (nayi + pichli) -> { key: { value, day, source, updatedAt, prev } }
async function latest(keys) {
  const r = await pool.query(
    `SELECT key, to_char(day, 'YYYY-MM-DD') AS day, value::float8 AS value, source, updated_at FROM (
       SELECT *, row_number() OVER (PARTITION BY key ORDER BY day DESC) AS rn
       FROM rates_history WHERE key = ANY($1::text[]) AND day <= ${todaySql}
     ) t WHERE rn <= 2 ORDER BY key, day DESC`,
    [keys]
  );
  const m = {};
  for (const row of r.rows) {
    if (!m[row.key]) m[row.key] = { value: row.value, day: row.day, source: row.source, updatedAt: row.updated_at, prev: null };
    else if (m[row.key].prev === null) m[row.key].prev = row.value;
  }
  return m;
}

async function history(keys, days = 14) {
  const r = await pool.query(
    `SELECT key, to_char(day, 'YYYY-MM-DD') AS day, value::float8 AS value
     FROM rates_history WHERE key = ANY($1::text[]) AND day > ${todaySql} - $2::int AND day <= ${todaySql}
     ORDER BY day DESC`,
    [keys, days]
  );
  const byDay = {};
  for (const row of r.rows) (byDay[row.day] = byDay[row.day] || {})[row.key] = row.value;
  return Object.keys(byDay).sort().reverse().map((d) => ({ day: d, ...byDay[d] }));
}

// ---------- Gold maths ----------
// xau_usd (ounce) * usd_pkr / 31.1035 = PKR per gram (24K). premium = local sarafa farq, Rs per tola (admin set karta hai)
function goldPrices(xauUsd, usdPkr, premiumTola = 0) {
  if (!(xauUsd > 0) || !(usdPkr > 0)) return null;
  const perGram24 = (xauUsd * usdPkr) / OZ_G;
  const tola24 = perGram24 * TOLA_G + (premiumTola || 0);
  const rows = KARATS.map(([label, k]) => {
    const tola = tola24 * (k / 24);
    return { label, tola, g10: tola / TOLA_G * 10, gram: tola / TOLA_G };
  });
  return { tola24, rows };
}
function silverPrices(xagUsd, usdPkr) {
  if (!(xagUsd > 0) || !(usdPkr > 0)) return null;
  const perGram = (xagUsd * usdPkr) / OZ_G;
  return { tola: perGram * TOLA_G, g10: perGram * 10, gram: perGram };
}

// ---------- Namaz timings (Aladhan: Karachi University method, Hanafi Asr) ----------
const prayerCache = new Map(); // "lahore|2026-10-08" -> data
const pkDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const clean = (t) => String(t || '').replace(/\s*\(.*\)\s*/, '').trim();

async function prayerTimes(cityKey) {
  const city = CITIES[cityKey];
  if (!city) return null;
  const day = pkDate();
  const ck = cityKey + '|' + day;
  if (prayerCache.has(ck)) return prayerCache.get(ck);
  try {
    const j = await getJson(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=Pakistan&method=1&school=1`);
    const t = j && j.data && j.data.timings;
    if (!t || !/^\d{1,2}:\d{2}/.test(clean(t.Fajr))) throw new Error('bad response');
    const h = j.data.date && j.data.date.hijri;
    const data = {
      city, day,
      times: [['Fajr', clean(t.Fajr)], ['Sunrise', clean(t.Sunrise)], ['Dhuhr', clean(t.Dhuhr)], ['Asr', clean(t.Asr)], ['Maghrib', clean(t.Maghrib)], ['Isha', clean(t.Isha)]],
      hijri: h ? `${h.day} ${h.month && h.month.en} ${h.year} AH` : null,
    };
    for (const k of prayerCache.keys()) if (!k.endsWith('|' + day)) prayerCache.delete(k); // purane din saaf
    prayerCache.set(ck, data);
    return data;
  } catch (e) {
    console.error('[rates] prayer', cityKey, e.message);
    return null;
  }
}

function startRates() {
  setTimeout(() => refresh(true), 25 * 1000);
  setInterval(() => refresh(false), 30 * 60 * 1000);
}

module.exports = {
  TZ, TOLA_G, KARATS, CURRENCIES, FUELS, CITIES,
  refresh, save, latest, history, goldPrices, silverPrices, prayerTimes, pkDate, startRates,
  _fetchFx: fetchFx, _fetchMetals: fetchMetals,
};
