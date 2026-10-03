// "X is typing..." : har chat ka ek scope hota hai. Browser poll ke saath batata hai ke main likh raha hoon,
// aur poll ke jawab mein wapas aata hai ke aur kaun likh raha hai (6 second se purani entry ginti mein nahi).
const pool = require('../db');

const dmScope = (a, b) => `dm:${Math.min(a, b)}-${Math.max(a, b)}`;
const groupScope = (groupId) => `g:${groupId}`;

async function touch(scope, userId) {
  await pool.query(
    `INSERT INTO typing_status (scope, user_id) VALUES ($1, $2)
     ON CONFLICT (scope, user_id) DO UPDATE SET updated_at = now()`,
    [scope, userId]
  );
  // Kabhi kabhi purani rows saaf (har 100 mein se ~1 baar)
  if (Math.random() < 0.01) {
    pool.query("DELETE FROM typing_status WHERE updated_at < now() - interval '1 hour'").catch(() => {});
  }
}

async function clear(scope, userId) {
  await pool.query('DELETE FROM typing_status WHERE scope = $1 AND user_id = $2', [scope, userId]);
}

// Doosre kaun likh rahe hain (usernames)
async function who(scope, meId) {
  const r = await pool.query(
    `SELECT u.username FROM typing_status t JOIN users u ON u.id = t.user_id
     WHERE t.scope = $1 AND t.user_id <> $2 AND t.updated_at > now() - interval '6 seconds'
     ORDER BY t.updated_at DESC LIMIT 3`,
    [scope, meId]
  );
  return r.rows.map((x) => x.username);
}

module.exports = { dmScope, groupScope, touch, clear, who };
