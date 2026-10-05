// Creators ki kamayi: feed post ke views -> wallet (paisa mein) -> manual withdraw (JazzCash / Easypaisa).
// 1 paisa har view par = 100 views par Rs 1 (config.earnPaisaPerView se badal sakte hain).
const pool = require('../db');
const config = require('../config');
const { notifyUser } = require('./notify');

const rs = (paisa) => (Number(paisa) / 100).toFixed(2);

// ---------- views -> wallet ----------
// Sirf wahi views gine jate hain jo feed.js pehle hi filter kar chuka hai (bots, admin aur owner ke apne views nahi).
// Email verified user hi kamata hai; hidden post ke views tab tak ruke rehte hain jab tak wo wapas dikhne na lage.
async function sync(userId) {
  if (!config.earnEnabled) return;
  try {
    await syncInvites(userId);
  } catch (err) {
    console.error('[earnings] invites (migration_v30.sql chali?):', err.message);
  }
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const u = (await c.query('SELECT email_verified, role FROM users WHERE id = $1', [userId])).rows[0];
    if (!u || !u.email_verified || u.role === 'admin') { await c.query('ROLLBACK'); return; }

    await c.query('INSERT INTO user_wallet (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
    const w = (await c.query('SELECT cap_day::text AS cap_day, cap_paisa FROM user_wallet WHERE user_id = $1 FOR UPDATE', [userId])).rows[0];
    const posts = (await c.query(
      `SELECT id, views - credited_views AS d FROM feed_posts
       WHERE user_id = $1 AND NOT is_hidden AND views > credited_views FOR UPDATE`, [userId])).rows;
    if (!posts.length) { await c.query('ROLLBACK'); return; }

    const today = (await c.query('SELECT (now() AT TIME ZONE $1)::date::text AS d', [config.timezone])).rows[0].d;
    const used = w.cap_day === today ? Number(w.cap_paisa) : 0;

    const newViews = posts.reduce((a, p) => a + p.d, 0);
    let credit = newViews * config.earnPaisaPerView;
    // Roz ki hadd: hadd se zyada views us din ke liye zaya (fraud / spike se bachao)
    if (config.earnDailyCapRs > 0) credit = Math.max(Math.min(credit, config.earnDailyCapRs * 100 - used), 0);

    await c.query('UPDATE feed_posts SET credited_views = views WHERE id = ANY($1::int[])', [posts.map((p) => p.id)]);
    if (credit > 0) {
      await c.query(
        `UPDATE user_wallet SET balance_paisa = balance_paisa + $2, total_earned_paisa = total_earned_paisa + $2,
                cap_day = $3::date, cap_paisa = $4, updated_at = now() WHERE user_id = $1`,
        [userId, credit, today, used + credit]
      );
    }
    await c.query('COMMIT');
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch (e) { /* ignore */ }
    throw err;
  } finally {
    c.release();
  }
}


// ---------- invite ka inaam ----------
// Har qualified dost (email verified + kam az kam ek kaam) par ek baar. UNIQUE index double-credit rokta hai.
async function syncInvites(userId) {
  const u = (await pool.query('SELECT email_verified, role FROM users WHERE id = $1', [userId])).rows[0];
  if (!u || !u.email_verified || u.role === 'admin') return;
  const have = (await pool.query("SELECT COUNT(*)::int AS n FROM earn_events WHERE user_id = $1 AND kind = 'invite'", [userId])).rows[0].n;
  const room = config.earnInviteMax - have;
  if (room <= 0) return;
  const R = require('./referral');
  const fresh = (await pool.query(
    `SELECT u.id FROM users u
     WHERE u.referred_by = $1 AND ${R.QUALIFIED}
       AND NOT EXISTS (SELECT 1 FROM earn_events e WHERE e.user_id = $1 AND e.kind = 'invite' AND e.ref_id = u.id)
     ORDER BY u.id LIMIT $2`, [userId, room])).rows;
  if (!fresh.length) return;
  const c = await pool.connect();
  let paid = 0;
  try {
    await c.query('BEGIN');
    await c.query('INSERT INTO user_wallet (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
    await c.query('SELECT 1 FROM user_wallet WHERE user_id = $1 FOR UPDATE', [userId]);
    for (const f of fresh) {
      const r = await c.query(
        `INSERT INTO earn_events (user_id, kind, ref_id, paisa) VALUES ($1, 'invite', $2, $3) ON CONFLICT DO NOTHING RETURNING id`,
        [userId, f.id, config.earnInvitePaisa]);
      if (r.rows[0]) paid += config.earnInvitePaisa;
    }
    if (paid > 0) {
      await c.query('UPDATE user_wallet SET balance_paisa = balance_paisa + $2, total_earned_paisa = total_earned_paisa + $2, updated_at = now() WHERE user_id = $1', [userId, paid]);
    }
    await c.query('COMMIT');
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch (e) { /* ignore */ }
    throw err;
  } finally {
    c.release();
  }
  if (paid > 0) {
    await notifyUser(userId, `You earned Rs ${rs(paid)} for inviting ${paid / config.earnInvitePaisa} friend${paid / config.earnInvitePaisa === 1 ? '' : 's'}.`, '/earnings');
  }
}

// ---------- blog parhne ka inaam ----------
// Post page khulte hi server session mein waqt likh leta hai; claim tabhi manzoor jab waqai itne seconds guzar chuke hon.
function startRead(req, postId) {
  const m = req.session.readStart && typeof req.session.readStart === 'object' ? req.session.readStart : {};
  m[postId] = Date.now();
  const keys = Object.keys(m);
  if (keys.length > 30) keys.sort((a, b) => m[a] - m[b]).slice(0, keys.length - 30).forEach((k) => delete m[k]);
  req.session.readStart = m;
}

async function readState(userId, postId) {
  const done = (await pool.query("SELECT 1 FROM earn_events WHERE user_id = $1 AND kind = 'read' AND ref_id = $2", [userId, postId])).rows[0];
  return !!done;
}

const dayStartSql = `(date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2)`;

// { ok, paisa } ya { error, code }
async function claimRead(userId, postId, startedAt) {
  if (!config.earnEnabled) return { error: 'Earnings are off.', code: 'off' };
  if (!startedAt || Date.now() - startedAt < (config.earnReadSeconds - 3) * 1000) return { error: 'Keep reading a little longer.', code: 'early' };
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const u = (await c.query('SELECT email_verified, role FROM users WHERE id = $1', [userId])).rows[0];
    if (!u || u.role === 'admin') { await c.query('ROLLBACK'); return { error: 'Not available.', code: 'off' }; }
    if (!u.email_verified) { await c.query('ROLLBACK'); return { error: 'Verify your email to earn from reading.', code: 'verify' }; }
    const p = (await c.query('SELECT 1 FROM posts p WHERE p.id = $1 AND p.is_draft = false AND p.publish_at <= now()', [postId])).rows[0];
    if (!p) { await c.query('ROLLBACK'); return { error: 'Post not found.', code: 'off' }; }

    await c.query('INSERT INTO user_wallet (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
    await c.query('SELECT 1 FROM user_wallet WHERE user_id = $1 FOR UPDATE', [userId]); // ek user ki requests line mein
    const used = (await c.query(
      `SELECT COALESCE(SUM(paisa), 0)::int AS s FROM earn_events
       WHERE user_id = $1 AND kind = 'read' AND created_at >= ${dayStartSql}`, [userId, config.timezone])).rows[0].s;
    if (used + config.earnReadPaisa > config.earnReadDailyCapRs * 100) {
      await c.query('ROLLBACK'); return { error: 'You reached today\'s reading limit. Come back tomorrow.', code: 'cap' };
    }
    const ins = await c.query(
      `INSERT INTO earn_events (user_id, kind, ref_id, paisa) VALUES ($1, 'read', $2, $3) ON CONFLICT DO NOTHING RETURNING id`,
      [userId, postId, config.earnReadPaisa]);
    if (!ins.rows[0]) { await c.query('ROLLBACK'); return { error: 'You already earned from this post.', code: 'done' }; }
    await c.query('UPDATE user_wallet SET balance_paisa = balance_paisa + $2, total_earned_paisa = total_earned_paisa + $2, updated_at = now() WHERE user_id = $1', [userId, config.earnReadPaisa]);
    await c.query('COMMIT');
    return { ok: true, paisa: config.earnReadPaisa };
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch (e) { /* ignore */ }
    throw err;
  } finally {
    c.release();
  }
}

async function overview(userId) {
  const w = (await pool.query('SELECT balance_paisa, total_earned_paisa, total_paid_paisa FROM user_wallet WHERE user_id = $1', [userId])).rows[0]
    || { balance_paisa: 0, total_earned_paisa: 0, total_paid_paisa: 0 };
  const v = (await pool.query(
    `SELECT COALESCE(SUM(views), 0)::int AS total,
            COALESCE(SUM(views - credited_views) FILTER (WHERE NOT is_hidden), 0)::int AS pending
     FROM feed_posts WHERE user_id = $1`, [userId])).rows[0];
  const top = (await pool.query(
    `SELECT id, left(body, 80) AS body, views FROM feed_posts WHERE user_id = $1 AND NOT is_hidden AND views > 0
     ORDER BY views DESC LIMIT 5`, [userId])).rows;
  const reqs = (await pool.query(
    'SELECT * FROM payout_requests WHERE user_id = $1 ORDER BY id DESC LIMIT 20', [userId])).rows;
  const verified = (await pool.query('SELECT email_verified FROM users WHERE id = $1', [userId])).rows[0];
  const ev = { read_n: 0, read_paisa: 0, invite_n: 0, invite_paisa: 0, read_today_paisa: 0 };
  try {
    const e = (await pool.query(
      `SELECT kind, COUNT(*)::int AS n, COALESCE(SUM(paisa), 0)::int AS p,
              COALESCE(SUM(paisa) FILTER (WHERE created_at >= ${dayStartSql}), 0)::int AS today
       FROM earn_events WHERE user_id = $1 GROUP BY kind`, [userId, config.timezone])).rows;
    e.forEach((x) => { ev[x.kind + '_n'] = x.n; ev[x.kind + '_paisa'] = x.p; if (x.kind === 'read') ev.read_today_paisa = x.today; });
  } catch (err) {
    console.error('[earnings] earn_events (migration_v30.sql chali?):', err.message);
  }
  return { wallet: w, views: v, top, requests: reqs, verified: !!(verified && verified.email_verified), ev };
}

// ---------- withdraw request ----------
function normPhone(v) {
  let n = String(v || '').replace(/[\s\-()]/g, '');
  if (/^\+923\d{9}$/.test(n)) n = '0' + n.slice(3);
  else if (/^923\d{9}$/.test(n)) n = '0' + n.slice(2);
  return /^03\d{9}$/.test(n) ? n : null;
}
const oneLine = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// { error } ya { ok, id }. Balance usi waqt kat jata hai (request pending rehne tak "hold" par).
async function requestWithdraw(userId, b) {
  if (!config.earnEnabled) return { error: 'Earnings are not turned on yet.' };
  const method = b.method === 'easypaisa' ? 'easypaisa' : b.method === 'jazzcash' ? 'jazzcash' : null;
  const number = normPhone(b.account_number);
  const name = oneLine(b.account_name, 80);
  const rupees = Math.floor(Number(b.amount));
  if (!method) return { error: 'Choose JazzCash or Easypaisa.' };
  if (!number) return { error: 'Enter a valid mobile number like 03001234567.' };
  if (name.length < 3) return { error: 'Enter the account holder name.' };
  if (!Number.isFinite(rupees) || rupees < config.earnMinWithdrawRs) {
    return { error: `Minimum withdrawal is Rs ${config.earnMinWithdrawRs}.` };
  }
  const paisa = rupees * 100;

  await sync(userId); // withdraw se pehle taaza views ginein
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const u = (await c.query('SELECT email_verified FROM users WHERE id = $1', [userId])).rows[0];
    if (!u || !u.email_verified) { await c.query('ROLLBACK'); return { error: 'Verify your email first to withdraw.' }; }
    const w = (await c.query('SELECT balance_paisa FROM user_wallet WHERE user_id = $1 FOR UPDATE', [userId])).rows[0];
    if (!w || Number(w.balance_paisa) < paisa) { await c.query('ROLLBACK'); return { error: 'Your balance is lower than that amount.' }; }
    const pend = await c.query("SELECT 1 FROM payout_requests WHERE user_id = $1 AND status = 'pending'", [userId]);
    if (pend.rows[0]) { await c.query('ROLLBACK'); return { error: 'You already have a pending withdrawal. Wait until it is processed.' }; }
    const r = await c.query(
      `INSERT INTO payout_requests (user_id, amount_paisa, method, account_number, account_name)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`, [userId, paisa, method, number, name]);
    await c.query('UPDATE user_wallet SET balance_paisa = balance_paisa - $2, updated_at = now() WHERE user_id = $1', [userId, paisa]);
    await c.query('COMMIT');
    return { ok: true, id: r.rows[0].id };
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch (e) { /* ignore */ }
    if (err.code === '23505') return { error: 'You already have a pending withdrawal.' };
    throw err;
  } finally {
    c.release();
  }
}

// ---------- admin ----------
async function pendingCount() {
  const r = await pool.query("SELECT COUNT(*)::int AS c FROM payout_requests WHERE status = 'pending'");
  return r.rows[0].c;
}

async function adminList() {
  const pending = (await pool.query(
    `SELECT r.*, u.username, u.email,
            COALESCE(w.total_earned_paisa, 0) AS total_earned_paisa, COALESCE(w.total_paid_paisa, 0) AS total_paid_paisa
     FROM payout_requests r JOIN users u ON u.id = r.user_id LEFT JOIN user_wallet w ON w.user_id = r.user_id
     WHERE r.status = 'pending' ORDER BY r.id`)).rows;
  const done = (await pool.query(
    `SELECT r.*, u.username FROM payout_requests r JOIN users u ON u.id = r.user_id
     WHERE r.status <> 'pending' ORDER BY r.processed_at DESC NULLS LAST, r.id DESC LIMIT 50`)).rows;
  const sums = (await pool.query(
    `SELECT COALESCE(SUM(balance_paisa), 0) AS owed, COALESCE(SUM(total_paid_paisa), 0) AS paid FROM user_wallet`)).rows[0];
  return { pending, done, owed: sums.owed, paid: sums.paid };
}

// Aap ne paisa bhej diya: status 'paid'. Sirf pending request par chalta hai (double-click safe).
async function markPaid(id, txn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = (await c.query(
      `UPDATE payout_requests SET status = 'paid', txn_ref = $2, processed_at = now()
       WHERE id = $1 AND status = 'pending' RETURNING user_id, amount_paisa, method`, [id, oneLine(txn, 60) || null])).rows[0];
    if (!r) { await c.query('ROLLBACK'); return { error: 'This request was already processed.' }; }
    await c.query('UPDATE user_wallet SET total_paid_paisa = total_paid_paisa + $2, updated_at = now() WHERE user_id = $1', [r.user_id, r.amount_paisa]);
    await c.query('COMMIT');
    await notifyUser(r.user_id, `Your withdrawal of Rs ${rs(r.amount_paisa)} was sent to your ${r.method === 'jazzcash' ? 'JazzCash' : 'Easypaisa'} account.`, '/earnings');
    return { ok: true };
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch (e) { /* ignore */ }
    throw err;
  } finally {
    c.release();
  }
}

// Reject: paisa wapas user ke wallet mein
async function reject(id, note) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = (await c.query(
      `UPDATE payout_requests SET status = 'rejected', admin_note = $2, processed_at = now()
       WHERE id = $1 AND status = 'pending' RETURNING user_id, amount_paisa`, [id, oneLine(note, 200) || null])).rows[0];
    if (!r) { await c.query('ROLLBACK'); return { error: 'This request was already processed.' }; }
    await c.query('UPDATE user_wallet SET balance_paisa = balance_paisa + $2, updated_at = now() WHERE user_id = $1', [r.user_id, r.amount_paisa]);
    await c.query('COMMIT');
    await notifyUser(r.user_id, `Your withdrawal of Rs ${rs(r.amount_paisa)} was not sent${note ? ': ' + oneLine(note, 120) : ''}. The amount is back in your balance.`, '/earnings');
    return { ok: true };
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch (e) { /* ignore */ }
    throw err;
  } finally {
    c.release();
  }
}

module.exports = { sync, syncInvites, startRead, readState, claimRead, overview, requestWithdraw, pendingCount, adminList, markPaid, reject, rs };
