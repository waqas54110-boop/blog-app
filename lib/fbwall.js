// Facebook wall: Facebook se aane wala (login na kiya hua) visitor post ka sirf shuru ka hissa parhta hai,
// baqi parhne ke liye account banana parta hai. Bots (facebookexternalhit, Googlebot...) ko poora post milta hai,
// is liye Facebook ka share preview aur Google SEO dono bilkul theek rehte hain.
const config = require('../config');

const FB_HOST = /(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/i;
const FB_APP_UA = /FBAN|FBAV|FB_IAB|FBIOS|FBDV|FB4A/i; // Facebook app ka in-app browser

function fromFacebook(req) {
  const q = req.query || {};
  if (String(q.utm_source || '').toLowerCase() === 'facebook') return true;
  if (q.fbclid) return true;
  const ua = req.get('User-Agent') || '';
  if (FB_APP_UA.test(ua)) return true;
  try {
    const host = new URL(req.get('Referer') || '').hostname;
    if (host && FB_HOST.test(host)) return true;
  } catch (e) { /* no referer */ }
  return false;
}

// Kya is request par wall lagni chahiye?
function shouldWall(req, res, isBot) {
  if (!config.fbWall) return false;
  if (req.session && req.session.user) return false; // login hai
  if (res.locals && res.locals.isAdmin) return false;
  if (isBot(req)) return false;
  return fromFacebook(req);
}

// HTML ko pehle N blocks (p, list, heading, quote...) par kaat do. Kuch kata to {html, cut:true}
// Post mein N se kam blocks hon (jaise 1 paragraph + tasveer) to bhi aakhri block chhupa dete hain, taake wall hamesha lage.
function teaser(html, blocks) {
  const re = /<\/(p|ul|ol|blockquote|h[1-6]|pre|table|figure)>/gi;
  const ends = [];
  let m;
  while ((m = re.exec(html))) ends.push(m.index + m[0].length);
  if (ends.length < 2) return { html, cut: false }; // sirf 1 block: chhupane ko kuch nahi
  const keep = Math.min(blocks, ends.length - 1);
  const end = ends[keep - 1];
  if (end >= html.length - 20) return { html, cut: false };
  return { html: html.slice(0, end), cut: true };
}

module.exports = { shouldWall, teaser, fromFacebook };
