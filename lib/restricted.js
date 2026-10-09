// Restricted products (V48): TikTok, Facebook aur Google weight-loss injections/pills, prescription dawaon
// aur "phone number par order" wali health ads ko ban karte hain. Agar Khabzo par aisi ad/product/post ho
// aur uska link TikTok/Facebook par jaye to hamara account bhi restrict ho jata hai (aisa hi hua tha).
// Ye filter ads, shop products/shop ki tafseel aur community feed posts par chalta hai (comments par nahi).
// List badalni ho to neeche DEFAULT_TERMS edit karein, ya app_settings mein key 'restricted_words'
// (har line ek lafz/jumla) daalein: wo list default ki jagah le leti hai.
const pool = require('../db');

const DEFAULT_TERMS = [
  // weight loss
  'weight loss', 'lose weight', 'losing weight', 'fat loss', 'fat burner', 'fat burning', 'belly fat', 'slimming', 'slim tea',
  'diet pill', 'diet pills', 'diet injection', 'skinny injection', 'appetite suppressant', 'detox tea', 'weight loss injection',
  'ozempic', 'wegovy', 'mounjaro', 'semaglutide', 'tirzepatide', 'liraglutide', 'saxenda',
  // injections / prescription-only
  'injection', 'injections', 'whitening injection', 'glutathione injection', 'hgh', 'growth hormone', 'steroid', 'steroids', 'sarms', 'anabolic',
  'abortion pill', 'abortion pills', 'cytotec', 'misoprostol',
  // sexual enhancement / "timing" medicines
  'timing tablet', 'timing tablets', 'sex power', 'sex tablet', 'power capsule',
  // roman urdu
  'wazan kam', 'wazan ghatane', 'wazan ghatayen', 'wazan ghatana', 'weight kam', 'motapa', 'motapay', 'patla hone', 'pait kam', 'tond kam',
];

let cache = { t: 0, terms: null };

const clean = (s) => ' ' + String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim() + ' ';

async function getTerms() {
  if (cache.terms && Date.now() - cache.t < 60 * 1000) return cache.terms;
  let terms = DEFAULT_TERMS;
  try {
    const r = await pool.query("SELECT value FROM app_settings WHERE key = 'restricted_words'");
    if (r.rows[0] && r.rows[0].value) {
      const custom = String(r.rows[0].value).split(/\r?\n|,/).map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 2);
      if (custom.length) terms = custom;
    }
  } catch (err) { /* app_settings na ho to default list */ }
  cache = { t: Date.now(), terms };
  return terms;
}

// Pehla milta hua lafz/jumla wapas deta hai (ya null). Poora lafz match hota hai ("slim" ko "slimming" se nahi milata).
async function find(text) {
  const t = clean(text);
  const terms = await getTerms();
  for (const w of terms) {
    const c = clean(w).trim();
    if (c && t.includes(' ' + c + ' ')) return w;
  }
  return null;
}

const MSG_EN = 'This looks like a restricted health product (weight-loss injections or pills, prescription medicines and similar). These are not allowed on Khabzo because TikTok, Facebook and Google ban them. If this is a mistake, please change the wording or contact the site owner.';
const MSG_UR = 'Ye restricted health product lagta hai (weight loss injection/goliyan, nuskhe wali dawaen wagera). Khabzo par inki ijazat nahi, kyunke TikTok, Facebook aur Google inhein ban karte hain. Agar ghalti se laga hai to lafz badal kar dobara try karein ya site owner se baat karein.';

module.exports = { find, MSG_EN, MSG_UR, DEFAULT_TERMS };
