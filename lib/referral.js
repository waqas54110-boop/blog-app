// Referral / invite link: har user ka apna code, /r/CODE link, aur "kis ne kis ko bulaya".
// Ek referral tab ginta hai jab bulaya hua dost: email verified ho AUR kam az kam ek kaam kare (vote / prediction / comment).
// Isi se fake accounts se giveaway entries bharna mushkil ho jata hai.
const crypto = require('crypto');
const pool = require('../db');
const { cookie } = require('./polls');
const { notifyUser } = require('./notify');

const CODE_RE = /^[a-f0-9]{8}$/;
const MAX_BONUS_ENTRIES = 5; // giveaway mein zyada se zyada itni extra entries (1 + 5 = 6)

// Badges: itne qualified referrals par
const TIERS = [
  { n: 3, icon: '🤝', name: 'Recruiter', desc: 'Brought 3 friends' },
  { n: 10, icon: '🚀', name: 'Super Recruiter', desc: 'Brought 10 friends' },
  { n: 25, icon: '👑', name: 'Ambassador', desc: 'Brought 25 friends' },
];

// SQL: alias `u` = bulaya hua user
const QUALIFIED = `u.email_verified = true AND (
  EXISTS (SELECT 1 FROM poll_votes x WHERE x.user_id = u.id)
  OR EXISTS (SELECT 1 FROM poll_match_votes x WHERE x.user_id = u.id)
  OR EXISTS (SELECT 1 FROM predictions x WHERE x.user_id = u.id)
  OR EXISTS (SELECT 1 FROM comments x WHERE x.user_id = u.id AND NOT x.is_hidden)
  OR EXISTS (SELECT 1 FROM poll_comments x WHERE x.user_id = u.id AND NOT x.is_hidden)
)`;

async function ensureCode(userId) {
  const read = async () => {
    const r = await pool.query('SELECT referral_code FROM users WHERE id = $1', [userId]);
    return r.rows[0] ? r.rows[0].referral_code : null;
  };
  const have = await read();
  if (have) return have;
  for (let i = 0; i < 5; i++) {
    try {
      const u = await pool.query(
        'UPDATE users SET referral_code = $2 WHERE id = $1 AND referral_code IS NULL RETURNING referral_code',
        [userId, crypto.randomBytes(4).toString('hex')]
      );
      if (u.rows[0]) return u.rows[0].referral_code;
      const now = await read(); // kisi aur request ne abhi bana diya
      if (now) return now;
    } catch (err) {
      if (err.code !== '23505') throw err; // code takra gaya: naya try
    }
  }
  throw new Error('could not create referral code');
}

// Naya user signup kare to: ref cookie dekho, referrer jor do, referrer ko batao.
// newUser = { id, username }. Koi masla ho to signup kabhi nahi rukta.
async function attach(newUser, req, res) {
  try {
    const code = cookie(req, 'ref');
    if (!CODE_RE.test(code)) return;
    res.clearCookie('ref');
    const r = await pool.query('SELECT id, username FROM users WHERE referral_code = $1', [code]);
    const ref = r.rows[0];
    if (!ref || ref.id === newUser.id) return;
    const u = await pool.query('UPDATE users SET referred_by = $2 WHERE id = $1 AND referred_by IS NULL RETURNING id', [newUser.id, ref.id]);
    if (u.rows[0]) {
      notifyUser(
        ref.id,
        `🎉 ${newUser.username} joined using your invite link. It counts once they verify their email and vote, predict or comment.`,
        '/invite'
      );
    }
  } catch (err) {
    console.error('[referral] attach:', err.message);
  }
}

async function referrerName(req) {
  try {
    const code = cookie(req, 'ref');
    if (!CODE_RE.test(code)) return null;
    const r = await pool.query('SELECT username FROM users WHERE referral_code = $1', [code]);
    return r.rows[0] ? r.rows[0].username : null;
  } catch (err) {
    return null;
  }
}

async function statsFor(userId) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS joined, COUNT(*) FILTER (WHERE ${QUALIFIED})::int AS qualified
     FROM users u WHERE u.referred_by = $1`,
    [userId]
  );
  return r.rows[0];
}

// ids -> Map(userId -> qualified referrals)
async function qualifiedCounts(ids) {
  if (!ids.length) return new Map();
  const r = await pool.query(
    `SELECT u.referred_by AS id, COUNT(*)::int AS n FROM users u
     WHERE u.referred_by = ANY($1::int[]) AND ${QUALIFIED} GROUP BY u.referred_by`,
    [ids]
  );
  return new Map(r.rows.map((x) => [x.id, x.n]));
}

async function leaderboard(limit = 10) {
  const r = await pool.query(
    `SELECT r.id, r.username, COUNT(*)::int AS n
     FROM users u JOIN users r ON r.id = u.referred_by
     WHERE ${QUALIFIED}
     GROUP BY r.id, r.username ORDER BY n DESC, r.username ASC LIMIT $1`,
    [limit]
  );
  return r.rows;
}

const tiersFor = (n) => TIERS.filter((t) => n >= t.n);
const nextTier = (n) => TIERS.find((t) => n < t.n) || null;

module.exports = {
  CODE_RE, MAX_BONUS_ENTRIES, TIERS, tiersFor, nextTier,
  ensureCode, attach, referrerName, statsFor, qualifiedCounts, leaderboard,
};
