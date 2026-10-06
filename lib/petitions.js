// V34: Raise Your Voice (Awaz Uthao) - mohalle / shehar ke masail par petitions aur signatures.
const pool = require('../db');
const { notifyUser } = require('./notify');

const CATEGORIES = ['Roads', 'Water', 'Electricity', 'Gas', 'Education', 'Health', 'Safety', 'Cleanliness', 'Other'];
const CITIES = [
  'Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Quetta', 'Gujranwala', 'Sialkot',
  'Hyderabad', 'Sargodha', 'Bahawalpur', 'Sukkur', 'Larkana', 'Abbottabad', 'Mardan', 'Gujrat', 'Sahiwal', 'Jhelum',
  'Sheikhupura', 'Rahim Yar Khan', 'Mirpur', 'Muzaffarabad', 'Gilgit',
];

// Ye milestones par creator ko (aur 100+ par admin ko) notification jati hai
const MILESTONES = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
const ADMIN_POST_FROM = 100;
const reached = (n) => MILESTONES.reduce((m, x) => (n >= x ? x : m), 0);
const nextGoal = (n) => MILESTONES.find((x) => x > n) || Math.ceil((n + 1) / 100000) * 100000;

function cleanCity(v) {
  const t = String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!t) return '';
  const known = CITIES.find((c) => c.toLowerCase() === t.toLowerCase());
  if (known) return known;
  return t.toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
}

const short = (s, n = 70) => (s.length > n ? s.slice(0, n - 3) + '...' : s);

// Signature lagana. Petition ki row lock hoti hai, is liye ginti aur milestone hamesha sahi rehte hain.
async function sign(petitionId, userId) {
  const cl = await pool.connect();
  let p = null; let count = 0; let crossed = 0;
  try {
    await cl.query('BEGIN');
    const pr = await cl.query('SELECT id, user_id, title, status, is_hidden FROM petitions WHERE id = $1 FOR UPDATE', [petitionId]);
    p = pr.rows[0];
    if (!p || p.is_hidden) { await cl.query('ROLLBACK'); return { error: 'This petition was not found.' }; }
    if (p.status !== 'active') { await cl.query('ROLLBACK'); return { error: 'This petition is no longer collecting signatures.' }; }
    const ins = await cl.query(
      'INSERT INTO petition_signatures (petition_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING user_id',
      [petitionId, userId]
    );
    if (!ins.rows[0]) { await cl.query('ROLLBACK'); return { error: 'You have already signed this petition.' }; }
    const up = await cl.query(
      'UPDATE petitions SET sign_count = sign_count + 1, updated_at = now() WHERE id = $1 RETURNING sign_count, milestone_notified',
      [petitionId]
    );
    count = up.rows[0].sign_count;
    const m = reached(count);
    if (m > up.rows[0].milestone_notified) {
      await cl.query('UPDATE petitions SET milestone_notified = $2 WHERE id = $1', [petitionId, m]);
      crossed = m;
    }
    await cl.query('COMMIT');
  } catch (e) {
    try { await cl.query('ROLLBACK'); } catch (e2) { /* ignore */ }
    throw e;
  } finally {
    cl.release();
  }
  if (crossed) {
    try {
      const link = `/petitions/${petitionId}`;
      if (p.user_id !== userId) await notifyUser(p.user_id, `Your petition "${short(p.title)}" just reached ${crossed} signatures!`, link);
      if (crossed >= ADMIN_POST_FROM) {
        await pool.query(
          `INSERT INTO notifications (user_id, message, link) SELECT id, $1, '/admin/petitions' FROM users WHERE role = 'admin'`,
          [`Petition ready to post: "${short(p.title, 60)}" reached ${crossed} signatures.`.slice(0, 295)]
        );
      }
    } catch (e) {
      console.error('[petitions] milestone notify:', e.message);
    }
  }
  return { ok: true, count, crossed };
}

async function unsign(petitionId, userId) {
  const cl = await pool.connect();
  try {
    await cl.query('BEGIN');
    const pr = await cl.query('SELECT user_id, status FROM petitions WHERE id = $1 FOR UPDATE', [petitionId]);
    const p = pr.rows[0];
    if (!p || p.user_id === userId || p.status !== 'active') { await cl.query('ROLLBACK'); return false; }
    const d = await cl.query('DELETE FROM petition_signatures WHERE petition_id = $1 AND user_id = $2 RETURNING user_id', [petitionId, userId]);
    if (d.rows[0]) await cl.query('UPDATE petitions SET sign_count = GREATEST(sign_count - 1, 0) WHERE id = $1', [petitionId]);
    await cl.query('COMMIT');
    return !!d.rows[0];
  } catch (e) {
    try { await cl.query('ROLLBACK'); } catch (e2) { /* ignore */ }
    throw e;
  } finally {
    cl.release();
  }
}

// Saare signers ko ek hi query se notification (author ko chhor kar)
async function notifySigners(petitionId, message, exceptUserId) {
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, message, link)
       SELECT user_id, $2, $3 FROM petition_signatures WHERE petition_id = $1 AND user_id <> $4`,
      [petitionId, message.slice(0, 295), `/petitions/${petitionId}`, exceptUserId || 0]
    );
  } catch (e) {
    console.error('[petitions] notifySigners:', e.message);
  }
}

module.exports = { CATEGORIES, CITIES, MILESTONES, ADMIN_POST_FROM, reached, nextGoal, cleanCity, sign, unsign, notifySigners, short };
