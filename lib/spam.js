// Spam filter: comments par chalta hai. Teen nateeje:
//   ok    -> comment lag jata hai
//   hold  -> comment save hota hai magar "hidden" + moderation queue mein (admin dekh kar approve/delete karega)
//   block -> comment save nahi hota, user ko wajah batai jati hai
// Spam words admin /admin/moderation page se badal sakta hai (app_settings mein 'spam_words', har line ek lafz/jumla).
const pool = require('../db');

// Default list: sirf saaf spam/scam. Gaali wagera ke alfaz admin apni marzi se isi list mein daal sakta hai.
const DEFAULT_WORDS = [
  'viagra', 'casino', 'porn', 'xxx', 'escort', 'sex chat', 'adult video',
  'buy followers', 'free followers', 'free likes', 'bitcoin doubler', 'crypto giveaway', 'forex signals',
  'guaranteed profit', 'click here to win', 'you have won', 'earn money online', 'work from home and earn',
  'join my telegram', 'join my whatsapp', 'whatsapp me', 'dm me for', 'loan approved',
  'paisay kamao', 'paise kamao', 'ghar baithe kamayen', 'ghar baithay kamayein',
];

const MAX_LINKS_BLOCK = 3;          // itne ya zyada links = seedha block
const NEW_ACCOUNT_DAYS = 3;         // is se nayi account ka link wala comment hold hota hai
const DUP_MINUTES = 10;             // ek hi comment dobara 10 minute ke andar nahi

let cache = { t: 0, words: null };
const LINK_RE = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]{2,}\.(?:com|net|org|info|biz|xyz|top|click|link|site|online|shop|live|club|ru|cn)\b/gi;

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function parseWords(text) {
  return [...new Set(String(text || '').split(/\r?\n|,/).map(norm).filter((w) => w.length >= 2 && w.length <= 60))].slice(0, 500);
}

async function getWords() {
  if (cache.words && Date.now() - cache.t < 60 * 1000) return cache.words;
  let words = DEFAULT_WORDS;
  try {
    const r = await pool.query("SELECT value FROM app_settings WHERE key = 'spam_words'");
    if (r.rows[0]) words = parseWords(r.rows[0].value);
  } catch (err) {
    console.error('[spam] words load:', err.message);
  }
  cache = { t: Date.now(), words };
  return words;
}

async function saveWords(text) {
  const words = parseWords(text);
  await pool.query(
    "INSERT INTO app_settings (key, value) VALUES ('spam_words', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [words.join('\n')]
  );
  cache = { t: 0, words: null };
  return words;
}

function findBadWord(text, words) {
  const t = ' ' + norm(text).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ') + ' ';
  for (const w of words) {
    const clean = w.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (clean && t.includes(' ' + clean + ' ')) return w;   // poora lafz/jumla (1 lafz "cat" ko "category" mein nahi pakarta)
  }
  return null;
}

// text: comment ka matn. Admin par filter nahi chalta.
async function check(text, { userId, isAdmin } = {}) {
  if (isAdmin) return { action: 'ok' };
  const body = String(text || '');

  const bad = findBadWord(body, await getWords());
  if (bad) return { action: 'block', reason: 'spam word', message: 'Your comment looks like spam, so it was not posted. If this is a mistake, please contact the site owner.' };

  const links = body.match(LINK_RE) || [];
  if (links.length >= MAX_LINKS_BLOCK) return { action: 'block', reason: 'too many links', message: 'Too many links in one comment. Please remove some and try again.' };

  if (userId) {
    try {
      const dup = await pool.query(
        `SELECT 1 FROM (
           SELECT body, created_at FROM comments WHERE user_id = $1
           UNION ALL SELECT body, created_at FROM poll_comments WHERE user_id = $1
         ) c WHERE lower(trim(c.body)) = lower(trim($2)) AND c.created_at > now() - ($3::int * interval '1 minute') LIMIT 1`,
        [userId, body, DUP_MINUTES]
      );
      if (dup.rows[0]) return { action: 'block', reason: 'duplicate', message: 'You already posted this comment a moment ago.' };
    } catch (err) {
      console.error('[spam] dup check:', err.message);
    }
  }

  if (links.length > 0 && userId) {
    try {
      const u = await pool.query(`SELECT (created_at > now() - ($2::int * interval '1 day')) AS fresh FROM users WHERE id = $1`, [userId, NEW_ACCOUNT_DAYS]);
      if (u.rows[0] && u.rows[0].fresh) return { action: 'hold', reason: 'link from a new account' };
    } catch (err) {
      console.error('[spam] age check:', err.message);
    }
  }

  if (/(.)\1{9,}/u.test(body)) return { action: 'hold', reason: 'repeated characters' };
  const words = norm(body).split(' ');
  if (words.length >= 8) {
    const counts = new Map();
    words.forEach((w) => counts.set(w, (counts.get(w) || 0) + 1));
    if (Math.max(...counts.values()) >= Math.ceil(words.length * 0.6)) return { action: 'hold', reason: 'repeated words' };
  }
  const letters = body.replace(/[^\p{L}]/gu, '');
  if (letters.length >= 25) {
    const upper = letters.replace(/[^\p{Lu}]/gu, '').length;
    if (upper / letters.length > 0.8) return { action: 'hold', reason: 'all caps' };
  }
  return { action: 'ok' };
}

module.exports = { check, getWords, saveWords, parseWords, DEFAULT_WORDS };
