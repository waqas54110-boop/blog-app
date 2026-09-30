// Vote contest ka saara logic: state banana, vote dena, knockout rounds, analytics events.
const crypto = require('crypto');
const pool = require('../db');
const { detectSource, isBot } = require('./analytics');

const isProd = process.env.NODE_ENV === 'production';
const DAY = 24 * 60 * 60 * 1000;

// ---------- chhote helpers ----------
const isOpen = (p) => {
  if (p.is_closed) return false;
  if (p.kind === 'knockout') return !p.winner_option_id;
  return !p.ends_at || new Date(p.ends_at).getTime() > Date.now();
};

// Percent ka jama hamesha 100 aaye (62 + 38), 33/33/33 na ho
function percents(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return counts.map(() => 0);
  const raw = counts.map((c) => (c * 100) / total);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  raw
    .map((r, i) => [r - out[i], i])
    .sort((a, b) => b[0] - a[0])
    .forEach(([, i]) => { if (left > 0) { out[i]++; left--; } });
  return out;
}

const roundName = (matchesInRound) =>
  matchesInRound === 1 ? 'Final' : matchesInRound === 2 ? 'Semi-finals' : matchesInRound === 4 ? 'Quarter-finals' : 'Round of ' + matchesInRound * 2;
const matchName = (matchesInRound, slot) =>
  matchesInRound === 1 ? 'Final' : matchesInRound === 2 ? 'Semi-final ' + (slot + 1) : matchesInRound === 4 ? 'Quarter-final ' + (slot + 1) : 'Match ' + (slot + 1);

// ---------- cookies (koi cookie-parser nahi, isliye khud) ----------
function cookie(req, name) {
  const h = req.headers.cookie || '';
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { return ''; }
    }
  }
  return '';
}
const cleanSrc = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9_\-.]/g, '').slice(0, 40);
const cookieOpts = (days) => ({ maxAge: days * DAY, httpOnly: true, sameSite: 'lax', secure: isProd });

// Vote kahan se aaya: contest ke page par aate waqt cookie mein yaad rakha (login ke baad bhi baaqi rehta hai)
const voteSource = (req, pollId) => cleanSrc(cookie(req, 'ps_' + pollId)) || 'direct';

// ---------- analytics events ----------
function trackView(req, res, pollId, via) {
  try {
    if (isBot(req)) return;
    if (req.session && req.session.user && req.session.user.role === 'admin') return;

    let vid = cookie(req, 'pv');
    if (!/^[a-f0-9]{16}$/.test(vid)) {
      vid = crypto.randomBytes(8).toString('hex');
      res.cookie('pv', vid, cookieOpts(365));
    }
    const det = detectSource(req);
    if (det.source !== 'internal' && det.source !== 'direct') {
      res.cookie('ps_' + pollId, cleanSrc(det.source), cookieOpts(30));
    }
    pool
      .query('INSERT INTO poll_events (poll_id, kind, source, via, visitor) VALUES ($1, $2, $3, $4, $5)',
        [pollId, 'view', cleanSrc(det.source) || 'direct', via, vid])
      .catch((err) => console.error('[poll-events]', err.message));
  } catch (err) {
    console.error('[poll-events]', err.message);
  }
}

function trackShare(req, pollId, channel) {
  try {
    if (isBot(req)) return;
    const vid = cookie(req, 'pv');
    pool
      .query('INSERT INTO poll_events (poll_id, kind, source, via, visitor) VALUES ($1, $2, $3, $4, $5)',
        [pollId, 'share', cleanSrc(channel) || 'other', 'page', /^[a-f0-9]{16}$/.test(vid) ? vid : null])
      .catch((err) => console.error('[poll-events]', err.message));
  } catch (err) {
    console.error('[poll-events]', err.message);
  }
}

// ---------- knockout ----------
// Ek round band karke jeetne walon se agla round banata hai (ya aakhri match ho to champion).
// force=false: sirf tab jab round ka time ho chuka ho.
async function advanceRound(pollId, force) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const p = (await c.query('SELECT * FROM polls WHERE id = $1 FOR UPDATE', [pollId])).rows[0];
    if (!p || p.kind !== 'knockout' || p.is_closed || p.winner_option_id) { await c.query('ROLLBACK'); return false; }
    if (!force && !(p.round_ends_at && new Date(p.round_ends_at).getTime() <= Date.now())) { await c.query('ROLLBACK'); return false; }

    const ms = (await c.query(
      `SELECT m.id, m.slot, m.a_option_id, m.b_option_id,
              (SELECT COUNT(*)::int FROM poll_match_votes v WHERE v.match_id = m.id AND v.option_id = m.a_option_id) AS va,
              (SELECT COUNT(*)::int FROM poll_match_votes v WHERE v.match_id = m.id AND v.option_id = m.b_option_id) AS vb
       FROM poll_matches m WHERE m.poll_id = $1 AND m.round = $2 ORDER BY m.slot`,
      [pollId, p.current_round]
    )).rows;
    if (!ms.length) { await c.query('ROLLBACK'); return false; }

    // Barabar votes: bracket mein pehle wala (a) aage jata hai
    const winners = [];
    for (const m of ms) {
      const w = m.vb > m.va ? m.b_option_id : m.a_option_id;
      winners.push(w);
      await c.query('UPDATE poll_matches SET winner_option_id = $1 WHERE id = $2', [w, m.id]);
    }

    if (ms.length === 1) {
      await c.query('UPDATE polls SET winner_option_id = $1, round_ends_at = NULL WHERE id = $2', [winners[0], pollId]);
    } else {
      const next = p.current_round + 1;
      for (let i = 0; i < winners.length; i += 2) {
        await c.query(
          'INSERT INTO poll_matches (poll_id, round, slot, a_option_id, b_option_id) VALUES ($1, $2, $3, $4, $5)',
          [pollId, next, i / 2, winners[i], winners[i + 1]]
        );
      }
      const ends = p.round_hours ? new Date(Date.now() + p.round_hours * 3600 * 1000).toISOString() : null;
      await c.query('UPDATE polls SET current_round = $1, round_ends_at = $2 WHERE id = $3', [next, ends, pollId]);
    }
    await c.query('COMMIT');
    return true;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('[knockout] advance:', err.message);
    return false;
  } finally {
    c.release();
  }
}

// Poll ki row; knockout round ka time ho chuka ho to pehle agla round chala do
async function getPoll(id) {
  let p = (await pool.query('SELECT * FROM polls WHERE id = $1', [id])).rows[0];
  if (p && p.kind === 'knockout' && !p.is_closed && !p.winner_option_id && p.round_ends_at && new Date(p.round_ends_at).getTime() <= Date.now()) {
    if (await advanceRound(id, false)) p = (await pool.query('SELECT * FROM polls WHERE id = $1', [id])).rows[0];
  }
  return p || null;
}

let schedulerTimer = null;
function startPollScheduler() {
  if (schedulerTimer) return;
  const tick = async () => {
    try {
      const r = await pool.query(
        `SELECT id FROM polls WHERE kind = 'knockout' AND is_closed = false AND winner_option_id IS NULL
           AND round_ends_at IS NOT NULL AND round_ends_at <= now()`
      );
      for (const { id } of r.rows) await advanceRound(id, false);
    } catch (err) {
      console.error('[poll-scheduler]', err.message);
    }
  };
  schedulerTimer = setInterval(tick, 60 * 1000);
  setTimeout(tick, 15 * 1000);
}

// ---------- create ----------
async function createPoll({ kind, title, options, endsAt, roundHours, userId }) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const roundEnds = kind === 'knockout' && roundHours ? new Date(Date.now() + roundHours * 3600 * 1000).toISOString() : null;
    const pr = await c.query(
      `INSERT INTO polls (title, a_name, a_image, b_name, b_image, ends_at, created_by, kind, round_hours, round_ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [title, options[0].name, options[0].image, options[1].name, options[1].image,
       kind === 'vote' ? endsAt : null, userId, kind, kind === 'knockout' ? roundHours : null, roundEnds]
    );
    const id = pr.rows[0].id;
    const ids = [];
    for (let i = 0; i < options.length; i++) {
      const r = await c.query(
        'INSERT INTO poll_options (poll_id, pos, name, image) VALUES ($1, $2, $3, $4) RETURNING id',
        [id, i, options[i].name, options[i].image]
      );
      ids.push(r.rows[0].id);
    }
    if (kind === 'knockout') {
      for (let i = 0; i < ids.length; i += 2) {
        await c.query(
          'INSERT INTO poll_matches (poll_id, round, slot, a_option_id, b_option_id) VALUES ($1, 1, $2, $3, $4)',
          [id, i / 2, ids[i], ids[i + 1]]
        );
      }
    }
    await c.query('COMMIT');
    return id;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

// ---------- vote ----------
async function castVote({ pollId, userId, optionId, matchId, source }) {
  const p = await getPoll(pollId);
  if (!p) return 'Contest not found.';
  if (!isOpen(p)) return 'Voting for this contest is closed.';
  if (!Number.isInteger(optionId)) return 'Please choose an option.';

  if (p.kind === 'knockout') {
    if (!Number.isInteger(matchId)) return 'Please choose a match.';
    const m = (await pool.query('SELECT * FROM poll_matches WHERE id = $1 AND poll_id = $2', [matchId, pollId])).rows[0];
    if (!m || m.round !== p.current_round || m.winner_option_id) return 'This match is not open for voting.';
    if (optionId !== m.a_option_id && optionId !== m.b_option_id) return 'Invalid choice.';
    await pool.query(
      `INSERT INTO poll_match_votes (match_id, user_id, poll_id, option_id, source) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (match_id, user_id) DO UPDATE SET option_id = EXCLUDED.option_id`,
      [matchId, userId, pollId, optionId, source || null]
    );
    return null;
  }

  const ok = await pool.query('SELECT 1 FROM poll_options WHERE id = $1 AND poll_id = $2', [optionId, pollId]);
  if (!ok.rows[0]) return 'Invalid choice.';
  await pool.query(
    `INSERT INTO poll_votes (poll_id, user_id, option_id, source) VALUES ($1, $2, $3, $4)
     ON CONFLICT (poll_id, user_id) DO UPDATE SET option_id = EXCLUDED.option_id`,
    [pollId, userId, optionId, source || null]
  );
  return null;
}

// Login se pehle dabaya hua vote login ke baad lagana (contest page ya post page par)
async function applyPending(req, pollId) {
  const pending = req.session.pendingVote;
  if (!req.session.user || !pending || pending.id !== pollId) return null;
  delete req.session.pendingVote;
  const err = await castVote({
    pollId, userId: req.session.user.id, optionId: pending.option, matchId: pending.match, source: voteSource(req, pollId),
  });
  return err || 'Your vote is saved ✅';
}

// ---------- state (page render + JSON, dono yahin se) ----------
// Plain contest = ek "match" (id 0) jis mein saare options. Knockout = kai matches.
async function loadState(id, userId, base) {
  const p = await getPoll(id);
  if (!p) return null;
  const open = isOpen(p);

  const optRows = (await pool.query('SELECT id, pos, name, image FROM poll_options WHERE poll_id = $1 ORDER BY pos', [id])).rows;
  const optById = new Map(optRows.map((o) => [o.id, o]));
  const build = (ids, counts) => {
    const list = ids.map((oid) => ({ ...optById.get(oid), votes: counts.get(oid) || 0 }));
    const pcts = percents(list.map((o) => o.votes));
    list.forEach((o, i) => { o.pct = pcts[i]; });
    return list;
  };

  let matches = [];
  let total = 0;

  if (p.kind === 'knockout') {
    const [ms, vs, mine] = await Promise.all([
      pool.query('SELECT * FROM poll_matches WHERE poll_id = $1 ORDER BY round, slot', [id]),
      pool.query('SELECT match_id, option_id, COUNT(*)::int AS c FROM poll_match_votes WHERE poll_id = $1 GROUP BY match_id, option_id', [id]),
      userId
        ? pool.query('SELECT match_id, option_id FROM poll_match_votes WHERE poll_id = $1 AND user_id = $2', [id, userId])
        : Promise.resolve({ rows: [] }),
    ]);
    const perMatch = new Map();
    vs.rows.forEach((r) => {
      if (!perMatch.has(r.match_id)) perMatch.set(r.match_id, new Map());
      perMatch.get(r.match_id).set(r.option_id, r.c);
    });
    const myBy = new Map(mine.rows.map((r) => [r.match_id, r.option_id]));
    const perRound = {};
    ms.rows.forEach((m) => { perRound[m.round] = (perRound[m.round] || 0) + 1; });
    matches = ms.rows.map((m) => {
      const counts = perMatch.get(m.id) || new Map();
      const options = build([m.a_option_id, m.b_option_id], counts);
      const t = options[0].votes + options[1].votes;
      total += t;
      return {
        id: m.id, round: m.round, slot: m.slot,
        roundLabel: roundName(perRound[m.round]), label: matchName(perRound[m.round], m.slot),
        active: open && m.round === p.current_round && !m.winner_option_id,
        winnerId: m.winner_option_id || null,
        myPick: myBy.get(m.id) || null,
        total: t, options,
      };
    });
  } else {
    const [vs, mine] = await Promise.all([
      pool.query('SELECT option_id, COUNT(*)::int AS c FROM poll_votes WHERE poll_id = $1 GROUP BY option_id', [id]),
      userId
        ? pool.query('SELECT option_id FROM poll_votes WHERE poll_id = $1 AND user_id = $2', [id, userId])
        : Promise.resolve({ rows: [] }),
    ]);
    const counts = new Map(vs.rows.map((r) => [r.option_id, r.c]));
    const options = build(optRows.map((o) => o.id), counts);
    total = options.reduce((a, o) => a + o.votes, 0);
    let winnerId = null;
    if (!open && total > 0) {
      const top = Math.max(...options.map((o) => o.votes));
      const tops = options.filter((o) => o.votes === top);
      if (tops.length === 1) winnerId = tops[0].id;
    }
    matches = [{
      id: 0, round: 1, slot: 0, roundLabel: null, label: null,
      active: open, winnerId, myPick: mine.rows[0] ? mine.rows[0].option_id : null, total, options,
    }];
  }

  const champion = p.winner_option_id ? optById.get(p.winner_option_id) || null : null;
  const round = p.kind === 'knockout' ? matches.find((m) => m.round === p.current_round) : null;
  return {
    id: p.id, kind: p.kind, title: p.title, open, isClosed: !!p.is_closed,
    now: Date.now(),
    endsAt: open ? (p.kind === 'knockout' ? p.round_ends_at : p.ends_at) || null : null,
    currentRound: p.current_round,
    currentRoundLabel: round ? round.roundLabel : null,
    roundHours: p.round_hours || null,
    champion: champion ? { id: champion.id, name: champion.name, image: champion.image } : null,
    total,
    matches,
    url: base ? `${base}/votes/${p.id}` : `/votes/${p.id}`,
    version: [p.current_round, p.is_closed ? 1 : 0, p.winner_option_id || 0, open ? 1 : 0, matches.length].join(':'),
  };
}

module.exports = {
  isOpen, percents, roundName, matchName, cookie,
  voteSource, trackView, trackShare,
  advanceRound, getPoll, startPollScheduler,
  createPoll, castVote, applyPending, loadState,
};
