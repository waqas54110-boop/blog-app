// Shop wall (V52): a visitor who is not logged in sees only the first part of the product page
// (photo, name, price, the first few characters of the description). Signup/login is needed for the rest and the order form.
// Bots (Google, Facebook preview) get the full page, so SEO and share cards keep working.
const config = require('../config');

function shouldWall(req, res, isBot) {
  if (!config.shopWall) return false;
  if (req.session && req.session.user) return false;   // logged in
  if (res.locals && res.locals.isAdmin) return false;
  if (isBot(req)) return false;
  return true;
}

// Cut the description at a word boundary; if cut, returns {text, cut:true}
function teaser(text, chars) {
  const s = String(text || '').trim();
  if (s.length <= chars) return { text: s, cut: false };
  let t = s.slice(0, chars);
  const sp = t.lastIndexOf(' ');
  if (sp > chars * 0.6) t = t.slice(0, sp);
  return { text: t.replace(/[\s,.;:-]+$/, '') + '...', cut: true };
}

module.exports = { shouldWall, teaser };
