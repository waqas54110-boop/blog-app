// Shop wall (V52): login na kiya hua insaan product page par sirf pehla hissa dekhta hai
// (photo, naam, price, description ke shuru ke kuch huroof). Baqi tafseel aur order form ke liye signup/login.
// Bots (Google, Facebook preview) ko poora page milta hai, is liye SEO aur share card theek rehte hain.
const config = require('../config');

function shouldWall(req, res, isBot) {
  if (!config.shopWall) return false;
  if (req.session && req.session.user) return false;   // login hai
  if (res.locals && res.locals.isAdmin) return false;
  if (isBot(req)) return false;
  return true;
}

// Description ko lafz ki hadd par kaato; kata to {text, cut:true}
function teaser(text, chars) {
  const s = String(text || '').trim();
  if (s.length <= chars) return { text: s, cut: false };
  let t = s.slice(0, chars);
  const sp = t.lastIndexOf(' ');
  if (sp > chars * 0.6) t = t.slice(0, sp);
  return { text: t.replace(/[\s,.;:-]+$/, '') + '...', cut: true };
}

module.exports = { shouldWall, teaser };
