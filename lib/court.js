// V34: People's Court (Awam ki Adalat).
// Admin ek masla (case) daalta hai -> 2 users "wakeel" ban kar dono taraf ki dalail dete hain -> awam "jury" ban kar vote karti hai
// -> jury ka waqt khatam hone par faisla (verdict). Ye sirf awam ki raaye hai, asli adalat nahi.
const pool = require('../db');
const config = require('../config');
const { notifyUser } = require('./notify');

const SIDES = ['a', 'b'];
const toSide = (v) => (v === 'a' || v === 'b' ? v : null);
const otherSide = (s) => (s === 'a' ? 'b' : 'a');

// recruiting = wakeel dhoondh rahe hain | expired = waqt nikal gaya, dono wakeel nahi aaye
// jury = jury vote kar rahi hai | closed = faisla ho chuka
function phaseOf(c, now = Date.now()) {
  if (!c.jury_starts_at) return new Date(c.recruit_until).getTime() > now ? 'recruiting' : 'expired';
  return new Date(c.jury_ends_at).getTime() > now ? 'jury' : 'closed';
}

function percents(a, b) {
  const t = a + b;
  if (!t) return [0, 0];
  const pa = Math.round((a * 100) / t);
  return [pa, 100 - pa];
}

function verdictOf(a, b) {
  if (a + b === 0) return 'none';
  if (a === b) return 'tie';
  return a > b ? 'a' : 'b';
}

async function counts(caseId, db = pool) {
  const r = await db.query('SELECT side, COUNT(*)::int AS n FROM court_votes WHERE case_id = $1 GROUP BY side', [caseId]);
  const out = { a: 0, b: 0 };
  r.rows.forEach((x) => { out[x.side] = x.n; });
  return out;
}

// Vote gin-ti sirf tab dikhti hai jab dekhne wale ne vote de diya ho, wo wakeel ho, admin ho ya case khatam ho
async function loadCase(id, uid, isAdmin) {
  const cr = await pool.query('SELECT * FROM court_cases WHERE id = $1', [id]);
  const c = cr.rows[0];
  if (!c || (c.is_hidden && !isAdmin)) return null;
  const lr = await pool.query(
    `SELECT l.side, l.user_id, l.opening, l.tagline, l.closing, l.created_at, u.username
       FROM court_lawyers l JOIN users u ON u.id = l.user_id WHERE l.case_id = $1`, [id]
  );
  const lawyers = { a: null, b: null };
  lr.rows.forEach((l) => { lawyers[l.side] = l; });
  const phase = phaseOf(c);
  const myLawyerSide = uid ? (SIDES.find((s) => lawyers[s] && lawyers[s].user_id === uid) || null) : null;
  let myVote = null;
  if (uid) {
    const v = await pool.query('SELECT side FROM court_votes WHERE case_id = $1 AND user_id = $2', [id, uid]);
    myVote = v.rows[0] ? v.rows[0].side : null;
  }
  const live = await counts(id);
  const total = live.a + live.b;
  const canSee = phase === 'closed' || !!myVote || !!myLawyerSide || !!isAdmin;
  let verdict = null;
  let final = live;
  if (phase === 'closed') {
    verdict = c.verdict || verdictOf(live.a, live.b);
    if (c.verdict) final = { a: c.votes_a || 0, b: c.votes_b || 0 };
  }
  const shown = phase === 'closed' ? final : live;
  const [pa, pb] = percents(shown.a, shown.b);
  const via = { a: 0, b: 0 };
  if (canSee) {
    const vr = await pool.query('SELECT via, COUNT(*)::int AS n FROM court_votes WHERE case_id = $1 AND via IS NOT NULL GROUP BY via', [id]);
    vr.rows.forEach((x) => { via[x.via] = x.n; });
  }
  return {
    c, phase, lawyers, myLawyerSide, myVote, total, canSee, verdict, via,
    result: canSee ? { a: shown.a, b: shown.b, pa, pb } : null,
    label: { a: c.side_a, b: c.side_b },
  };
}

// Wakeel banna + dalail (ek hi step mein; dalail baad mein badli nahi jati)
async function argue({ caseId, userId, side, opening, tagline }) {
  const cl = await pool.connect();
  let started = false;
  let caseRow = null;
  let err = null;
  try {
    await cl.query('BEGIN');
    const cr = await cl.query('SELECT * FROM court_cases WHERE id = $1 FOR UPDATE', [caseId]);
    caseRow = cr.rows[0];
    if (!caseRow || caseRow.is_hidden) err = 'This case was not found.';
    else if (phaseOf(caseRow) !== 'recruiting') err = 'Lawyers can no longer join this case.';
    else {
      const mine = await cl.query('SELECT 1 FROM court_lawyers WHERE case_id = $1 AND user_id = $2', [caseId, userId]);
      if (mine.rows[0]) err = 'You are already a lawyer in this case.';
      else {
        const taken = await cl.query('SELECT 1 FROM court_lawyers WHERE case_id = $1 AND side = $2', [caseId, side]);
        if (taken.rows[0]) err = 'Someone else just took this side. Try the other side or another case.';
      }
    }
    if (err) { await cl.query('ROLLBACK'); return { error: err }; }
    await cl.query(
      'INSERT INTO court_lawyers (case_id, side, user_id, opening, tagline) VALUES ($1, $2, $3, $4, $5)',
      [caseId, side, userId, opening, tagline]
    );
    const n = await cl.query('SELECT COUNT(*)::int AS n FROM court_lawyers WHERE case_id = $1', [caseId]);
    if (n.rows[0].n >= 2) {
      await cl.query(
        `UPDATE court_cases SET jury_starts_at = now(), jury_ends_at = now() + (jury_hours * interval '1 hour') WHERE id = $1`,
        [caseId]
      );
      started = true;
    }
    await cl.query('COMMIT');
  } catch (e) {
    try { await cl.query('ROLLBACK'); } catch (e2) { /* ignore */ }
    if (e && e.code === '23505') return { error: 'Someone else just took this side. Try the other side or another case.' };
    throw e;
  } finally {
    cl.release();
  }
  try {
    const link = `/court/${caseId}`;
    const short = caseRow.title.length > 70 ? caseRow.title.slice(0, 67) + '...' : caseRow.title;
    const other = await pool.query('SELECT user_id FROM court_lawyers WHERE case_id = $1 AND user_id <> $2', [caseId, userId]);
    if (started) {
      for (const o of other.rows) {
        await notifyUser(o.user_id, `Both lawyers have argued in "${short}". The jury is now voting - rally your supporters!`, link);
      }
      await notifyUser(userId, `The jury is now voting on "${short}". Share your link to bring supporters!`, link);
    } else if (caseRow.created_by && caseRow.created_by !== userId) {
      await notifyUser(caseRow.created_by, `A lawyer has taken a side in "${short}". One seat is still open.`, link);
    }
  } catch (e) {
    console.error('[court] notify:', e.message);
  }
  return { ok: true, started };
}

// Jury vote (ek user ek vote, wakeel vote nahi de sakta)
async function castVote({ caseId, userId, side, via }) {
  const cr = await pool.query('SELECT * FROM court_cases WHERE id = $1', [caseId]);
  const c = cr.rows[0];
  if (!c || c.is_hidden) return 'This case was not found.';
  if (phaseOf(c) !== 'jury') return 'The jury is not voting on this case right now.';
  const l = await pool.query('SELECT 1 FROM court_lawyers WHERE case_id = $1 AND user_id = $2', [caseId, userId]);
  if (l.rows[0]) return 'Lawyers in a case cannot sit on its jury.';
  const ins = await pool.query(
    'INSERT INTO court_votes (case_id, user_id, side, via) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING user_id',
    [caseId, userId, side, toSide(via)]
  );
  if (!ins.rows[0]) return 'You have already voted on this case.';
  return null;
}

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function verdictText(c, verdict) {
  if (verdict === 'none') return 'No jurors voted, so there is no verdict.';
  if (verdict === 'tie') return 'Hung jury: the vote ended in a tie.';
  return `Verdict: ${verdict === 'a' ? c.side_a : c.side_b}`;
}

// Jin cases ka waqt khatam ho gaya unka result save + notification (har case sirf ek baar)
async function finalizeDue() {
  const due = await pool.query(
    'SELECT id FROM court_cases WHERE jury_ends_at IS NOT NULL AND jury_ends_at <= now() AND verdict IS NULL ORDER BY id LIMIT 20'
  );
  for (const { id } of due.rows) {
    const cnt = await counts(id);
    const verdict = verdictOf(cnt.a, cnt.b);
    const up = await pool.query(
      'UPDATE court_cases SET verdict = $2, votes_a = $3, votes_b = $4 WHERE id = $1 AND verdict IS NULL RETURNING *',
      [id, verdict, cnt.a, cnt.b]
    );
    if (!up.rows[0]) continue;
    const c = up.rows[0];
    const short = c.title.length > 70 ? c.title.slice(0, 67) + '...' : c.title;
    const msg = `The jury has decided: "${short}". ${verdictText(c, verdict)}`.slice(0, 295);
    try {
      await pool.query(
        `INSERT INTO notifications (user_id, message, link)
         SELECT user_id, $2, $3 FROM (
           SELECT user_id FROM court_votes WHERE case_id = $1
           UNION SELECT user_id FROM court_lawyers WHERE case_id = $1
         ) t`,
        [id, msg, `/court/${id}`]
      );
    } catch (e) {
      console.error('[court] verdict notify:', e.message);
    }
  }
}

// Telegram (token set ho to): jury shuru + faisla, har ek sirf ek baar
async function telegramTick() {
  let T;
  try { T = require('./telegram'); } catch (e) { return; }
  if (!T.isConfigured() || !config.siteUrl) return;
  const card = require('./card');
  const photo = (id) => (card.isAvailable() ? `${config.siteUrl}/og/court/${id}.png` : null);
  const url = (id) => `${config.siteUrl}/court/${id}?utm_source=telegram&utm_medium=channel`;

  const start = await pool.query(
    `SELECT id FROM court_cases WHERE jury_starts_at IS NOT NULL AND jury_sent = false AND NOT is_hidden
        AND jury_starts_at > now() - interval '2 days' ORDER BY id LIMIT 5`
  );
  for (const { id } of start.rows) {
    const claim = await pool.query('UPDATE court_cases SET jury_sent = true WHERE id = $1 AND jury_sent = false RETURNING *', [id]);
    const c = claim.rows[0];
    if (!c) continue;
    const r = await T.sendPost({
      text: `<b>People's Court is in session</b>\n${esc(c.title)}\n\n${esc(c.side_a)} vs ${esc(c.side_b)}\n\nYou are the jury. Read both arguments and vote.`,
      photo: photo(id), buttonText: 'Be on the jury', buttonUrl: url(id),
    });
    if (!r.ok && r.retry) await pool.query('UPDATE court_cases SET jury_sent = false WHERE id = $1', [id]);
  }

  const done = await pool.query(
    `SELECT id FROM court_cases WHERE verdict IS NOT NULL AND verdict_sent = false AND NOT is_hidden
        AND jury_ends_at > now() - interval '3 days' ORDER BY id LIMIT 5`
  );
  for (const { id } of done.rows) {
    const claim = await pool.query('UPDATE court_cases SET verdict_sent = true WHERE id = $1 AND verdict_sent = false RETURNING *', [id]);
    const c = claim.rows[0];
    if (!c) continue;
    const [pa, pb] = percents(c.votes_a || 0, c.votes_b || 0);
    const r = await T.sendPost({
      text: `<b>The jury has spoken</b>\n${esc(c.title)}\n\n${esc(verdictText(c, c.verdict))}\n${esc(c.side_a)}: ${pa}% | ${esc(c.side_b)}: ${pb}% (${(c.votes_a || 0) + (c.votes_b || 0)} jurors)`,
      photo: photo(id), buttonText: 'Read the arguments', buttonUrl: url(id),
    });
    if (!r.ok && r.retry) await pool.query('UPDATE court_cases SET verdict_sent = false WHERE id = $1', [id]);
  }
}

let timer = null;
let busy = false;
function startCourtScheduler() {
  if (timer) return;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await finalizeDue(); await telegramTick(); }
    catch (err) { console.error('[court-scheduler]', err.message); }
    finally { busy = false; }
  };
  timer = setInterval(tick, 60 * 1000);
  setTimeout(tick, 25 * 1000);
}

module.exports = {
  SIDES, toSide, otherSide, phaseOf, percents, verdictOf, verdictText,
  loadCase, argue, castVote, finalizeDue, startCourtScheduler,
};
