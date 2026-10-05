// Age / gender / country ke helpers + visitor pehchan (analytics ke liye).
const crypto = require('crypto');

const COUNTRIES = {
  PK: 'Pakistan', IN: 'India', BD: 'Bangladesh', AF: 'Afghanistan', LK: 'Sri Lanka', NP: 'Nepal',
  AE: 'United Arab Emirates', SA: 'Saudi Arabia', QA: 'Qatar', KW: 'Kuwait', OM: 'Oman', BH: 'Bahrain',
  TR: 'Turkey', IR: 'Iran', IQ: 'Iraq', EG: 'Egypt', JO: 'Jordan', LB: 'Lebanon',
  GB: 'United Kingdom', US: 'United States', CA: 'Canada', AU: 'Australia', NZ: 'New Zealand',
  DE: 'Germany', FR: 'France', IT: 'Italy', ES: 'Spain', NL: 'Netherlands', SE: 'Sweden', NO: 'Norway',
  DK: 'Denmark', FI: 'Finland', IE: 'Ireland', PT: 'Portugal', CH: 'Switzerland', BE: 'Belgium',
  AT: 'Austria', PL: 'Poland', RU: 'Russia', UA: 'Ukraine', CN: 'China', JP: 'Japan', KR: 'South Korea',
  MY: 'Malaysia', SG: 'Singapore', ID: 'Indonesia', TH: 'Thailand', VN: 'Vietnam', PH: 'Philippines',
  ZA: 'South Africa', NG: 'Nigeria', KE: 'Kenya', MA: 'Morocco', DZ: 'Algeria',
  BR: 'Brazil', MX: 'Mexico', AR: 'Argentina', CO: 'Colombia', ZZ: 'Other',
};
const COUNTRY_LIST = Object.entries(COUNTRIES)
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => (a.code === 'ZZ') - (b.code === 'ZZ') || a.name.localeCompare(b.name));

const GENDERS = ['male', 'female', 'other'];

const countryName = (code) => (code ? COUNTRIES[code] || code : 'Unknown');
// 'PK' -> 🇵🇰
const flag = (code) =>
  /^[A-Z]{2}$/.test(code || '') && code !== 'ZZ'
    ? String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
    : '🌍';

const MIN_AGE = 13;
const MAX_AGE = 100;
const cleanBirthYear = (v) => {
  const y = parseInt(v, 10);
  const now = new Date().getFullYear();
  return Number.isInteger(y) && y >= now - MAX_AGE && y <= now - MIN_AGE ? y : null;
};
const cleanGender = (v) => (GENDERS.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : null);
const cleanCountry = (v) => {
  const c = String(v || '').toUpperCase();
  return COUNTRIES[c] ? c : null;
};

const AGE_GROUPS = ['13-17', '18-24', '25-34', '35-44', '45-54', '55+'];
function ageGroup(birthYear) {
  if (!birthYear) return null;
  const age = new Date().getFullYear() - birthYear;
  if (age < MIN_AGE || age > MAX_AGE) return null;
  if (age <= 17) return '13-17';
  if (age <= 24) return '18-24';
  if (age <= 34) return '25-34';
  if (age <= 44) return '35-44';
  if (age <= 54) return '45-54';
  return '55+';
}

// Guest ka country: hosting/CDN ke headers se (Cloudflare, Vercel, CloudFront...), warna geoip-lite (agar install ho)
let geoip = null;
try { geoip = require('geoip-lite'); } catch (e) { /* optional */ }
const GEO_HEADERS = ['cf-ipcountry', 'x-vercel-ip-country', 'cloudfront-viewer-country', 'x-country-code', 'x-appengine-country'];
function geoCountry(req) {
  for (const h of GEO_HEADERS) {
    const v = String(req.get(h) || '').toUpperCase();
    if (/^[A-Z]{2}$/.test(v) && v !== 'XX' && v !== 'T1') return v;
  }
  if (geoip) {
    try {
      const hit = geoip.lookup(req.ip);
      if (hit && /^[A-Z]{2}$/.test(hit.country)) return hit.country;
    } catch (e) { /* ignore */ }
  }
  return null;
}

// ---------- visitor id (cookie 'pv', vote contests wali wohi) ----------
const isProd = process.env.NODE_ENV === 'production';
function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { return ''; }
    }
  }
  return '';
}
// Login ho to 'u<id>' (har device par ek hi banda), warna browser cookie. Cookie sync set hoti hai (render se pehle).
function visitorId(req, res) {
  const u = req.session && req.session.user;
  if (u && u.id) return 'u' + u.id;
  let vid = readCookie(req, 'pv');
  if (!/^[a-f0-9]{16}$/.test(vid)) {
    vid = crypto.randomBytes(8).toString('hex');
    res.cookie('pv', vid, { maxAge: 365 * 24 * 3600 * 1000, httpOnly: true, sameSite: 'lax', secure: isProd });
  }
  return vid;
}

module.exports = {
  COUNTRIES, COUNTRY_LIST, GENDERS, AGE_GROUPS, MIN_AGE, MAX_AGE,
  countryName, flag, cleanBirthYear, cleanGender, cleanCountry, ageGroup, geoCountry, visitorId,
};
