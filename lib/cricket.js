// Street Cricket Manager (V35/V36): ball-by-ball scoring engine. All state is derived from cricket_balls (no cached score),
// so undo / fixing a mistake is easy and the scorecard can never drift out of sync.
const pool = require('./../db');

const WICKET_TYPES = ['bowled', 'caught', 'lbw', 'runout', 'stumped', 'hitwicket', 'retired'];
const BOWLER_WICKETS = ['bowled', 'caught', 'lbw', 'stumped', 'hitwicket'];

const isLegal = (b) => b.extra_type !== 'wd' && b.extra_type !== 'nb';
const total = (b) => b.runs_bat + b.extra_runs;
const oversText = (legal) => `${Math.floor(legal / 6)}.${legal % 6}`;
const shortName = (n) => {
  const w = String(n || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '---';
  const s = w.length === 1 ? w[0].slice(0, 3) : w.map((x) => x[0]).join('').slice(0, 3);
  return s.toUpperCase();
};

// Short label for one ball (used by the "this over" strip)
function ballLabel(b) {
  if (b.is_wicket) return b.extra_type ? 'W+' + (b.extra_type === 'wd' ? 'wd' : 'nb') : 'W';
  if (b.extra_type === 'wd') return b.extra_runs > 1 ? `wd+${b.extra_runs - 1}` : 'wd';
  if (b.extra_type === 'nb') return b.runs_bat ? `nb+${b.runs_bat}` : 'nb';
  if (b.extra_type === 'b') return `${b.extra_runs}b`;
  if (b.extra_type === 'lb') return `${b.extra_runs}lb`;
  return String(b.runs_bat);
}

// Summary of one innings. balls = only this innings' balls (ordered by id)
function summarize(balls, maxOvers, batCount) {
  let runs = 0, wkts = 0, legal = 0, extras = 0;
  let over = [];
  const bat = new Map(), bowl = new Map();
  const B = (id) => { if (!bat.has(id)) bat.set(id, { id, runs: 0, balls: 0, fours: 0, sixes: 0, out: null }); return bat.get(id); };
  const W = (id) => { if (!bowl.has(id)) bowl.set(id, { id, legal: 0, runs: 0, wkts: 0, maidenRuns: 0 }); return bowl.get(id); };
  const batOrder = [];
  let lastBall = null;
  for (const b of balls) {
    runs += total(b);
    if (b.extra_type) extras += b.extra_runs;
    if (isLegal(b)) legal += 1;
    if (b.is_wicket && b.wicket_type !== 'retired') wkts += 1;

    for (const id of [b.striker_id, b.non_striker_id]) { if (id && !batOrder.includes(id)) batOrder.push(id); }
    const s = B(b.striker_id);
    if (b.extra_type !== 'wd') s.balls += 1;
    s.runs += b.runs_bat;
    if (b.runs_bat === 4) s.fours += 1;
    if (b.runs_bat === 6) s.sixes += 1;
    if (b.is_wicket && b.out_id) B(b.out_id).out = b.wicket_type;

    const w = W(b.bowler_id);
    if (isLegal(b)) w.legal += 1;
    w.runs += b.runs_bat + ((b.extra_type === 'wd' || b.extra_type === 'nb') ? b.extra_runs : 0);
    if (b.is_wicket && BOWLER_WICKETS.includes(b.wicket_type)) w.wkts += 1;

    over.push(ballLabel(b));
    if (isLegal(b) && legal % 6 === 0) over = [];
    lastBall = b;
  }
  const overRuns = (() => {
    let r = 0, l = 0;
    // runs in the current over
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      r += total(b);
      if (isLegal(b)) { l += 1; }
      if (l === 6) break;
    }
    return r;
  })();
  const wicketsMax = Math.max(1, batCount - 1);
  return {
    runs, wkts, legal, extras, overs: oversText(legal), thisOver: over, lastBall,
    batters: [...bat.values()], bowlers: [...bowl.values()], batOrder,
    crr: legal ? (runs * 6 / legal) : 0,
    allOut: wkts >= wicketsMax,
    oversDone: legal >= maxOvers * 6,
    _overRuns: overRuns,
  };
}

// Suggestion for the next ball: who is on strike, who is at the other end, and whether a new batter / bowler is needed
function suggestNext(sum) {
  const b = sum.lastBall;
  if (!b) return { striker: null, nonStriker: null, bowler: null, needBatter: false, needBowler: false };
  let s = b.striker_id, n = b.non_striker_id;
  const ran = b.runs_bat + ((b.extra_type === 'b' || b.extra_type === 'lb') ? b.extra_runs : 0) + (b.extra_type === 'wd' ? Math.max(0, b.extra_runs - 1) : 0);
  if (b.is_wicket && b.wicket_type !== 'retired') { if (b.out_id === s) s = null; else if (b.out_id === n) n = null; }
  if (ran % 2 === 1) { const t = s; s = n; n = t; }
  const overEnd = isLegal(b) && sum.legal % 6 === 0;
  if (overEnd) { const t = s; s = n; n = t; }
  return { striker: s, nonStriker: n, bowler: overEnd ? null : b.bowler_id, lastBowler: b.bowler_id, needBatter: s == null || n == null, needBowler: overEnd };
}

// ---------- database ----------
async function loadMatch(id) {
  const m = (await pool.query(
    `SELECT m.*, t.name AS t_name, t.owner_id, t.city,
            ta.name AS a_name, tb.name AS b_name, u.username AS owner_name, su.username AS scorer_name
       FROM cricket_matches m
       JOIN cricket_tournaments t ON t.id = m.tournament_id
       JOIN cricket_teams ta ON ta.id = m.team_a
       JOIN cricket_teams tb ON tb.id = m.team_b
       JOIN users u ON u.id = t.owner_id
       LEFT JOIN users su ON su.id = m.scorer_id
      WHERE m.id = $1`, [id])).rows[0];
  return m || null;
}

// Photos need migration_v36.sql. Until it is run, fall back to the old query so scoring keeps working.
let photoCol = true;
async function teamPlayers(teamIds) {
  const sql = (withPhoto) => `SELECT tp.team_id, p.id, p.name, ${withPhoto ? 'p.photo_image_id' : 'NULL::int AS photo_image_id'}
       FROM cricket_team_players tp JOIN cricket_players p ON p.id = tp.player_id
       WHERE tp.team_id = ANY($1::int[]) ORDER BY p.name`;
  if (photoCol) {
    try { return (await pool.query(sql(true), [teamIds])).rows; } catch (e) { if (e.code !== '42703') throw e; photoCol = false; }
  }
  return (await pool.query(sql(false), [teamIds])).rows;
}
const photoUrl = (id) => (id ? `/img/${id}` : null);

// Full state: scorecard page, scorer page, JSON poll and the live score bar all use this
async function fullState(matchId) {
  const m = await loadMatch(matchId);
  if (!m) return null;
  const [pl, br] = await Promise.all([
    teamPlayers([m.team_a, m.team_b]),
    pool.query('SELECT * FROM cricket_balls WHERE match_id = $1 ORDER BY id', [matchId]),
  ]);
  const names = new Map(pl.map((p) => [p.id, p.name]));
  const photos = new Map(pl.map((p) => [p.id, photoUrl(p.photo_image_id)]));
  const aPl = pl.filter((p) => p.team_id === m.team_a), bPl = pl.filter((p) => p.team_id === m.team_b);
  const teamName = (id) => (id === m.team_a ? m.a_name : m.b_name);
  const count = (id) => (id === m.team_a ? aPl.length : bPl.length);
  const firstBat = m.toss_winner ? (m.toss_choice === 'bat' ? m.toss_winner : (m.toss_winner === m.team_a ? m.team_b : m.team_a)) : m.team_a;
  const secondBat = firstBat === m.team_a ? m.team_b : m.team_a;

  const byInn = (n) => br.rows.filter((b) => b.innings === n);
  const inn1 = summarize(byInn(1), m.overs, count(firstBat));
  const inn2 = summarize(byInn(2), m.overs, count(secondBat));
  const cur = m.innings === 2 ? inn2 : inn1;
  const batId = m.innings === 2 ? secondBat : firstBat;
  const bowlId = batId === m.team_a ? m.team_b : m.team_a;
  const target = m.innings === 2 ? (inn1.runs + 1) : null;
  const curOver = (cur.oversDone || cur.allOut || (m.innings === 2 && cur.runs >= target));

  const nm = (id) => (id ? names.get(id) || '?' : null);
  const decorate = (s) => ({
    ...s,
    batters: s.batters.map((x) => ({ ...x, name: nm(x.id), photo: photos.get(x.id) || null, sr: x.balls ? (x.runs * 100 / x.balls) : 0 })),
    bowlers: s.bowlers.map((x) => ({ ...x, name: nm(x.id), photo: photos.get(x.id) || null, overs: oversText(x.legal), econ: x.legal ? (x.runs * 6 / x.legal) : 0 })),
  });
  const next = suggestNext(cur);
  const out = {
    match: { id: m.id, status: m.status, innings: m.innings, overs: m.overs, result: m.result, winner_id: m.winner_id, target, show_on_stream: m.show_on_stream,
      tournament_id: m.tournament_id, tournament: m.t_name, city: m.city, owner_id: m.owner_id, owner: m.owner_name, scorer_id: m.scorer_id, scorer: m.scorer_name,
      toss: m.toss_winner ? `${teamName(m.toss_winner)} won the toss and chose to ${m.toss_choice}` : null, scheduled_at: m.scheduled_at },
    teams: { a: { id: m.team_a, name: m.a_name, short: shortName(m.a_name), players: aPl }, b: { id: m.team_b, name: m.b_name, short: shortName(m.b_name), players: bPl } },
    batTeam: batId, bowlTeam: bowlId, firstBat, secondBat,
    inn1: decorate(inn1), inn2: decorate(inn2),
    cur: { ...decorate(cur), over: curOver, target, need: target ? Math.max(0, target - cur.runs) : null,
      ballsLeft: Math.max(0, m.overs * 6 - cur.legal),
      rrr: target && m.overs * 6 - cur.legal > 0 ? ((target - cur.runs) * 6 / (m.overs * 6 - cur.legal)) : null },
    next: { ...next, strikerName: nm(next.striker), nonStrikerName: nm(next.nonStriker), bowlerName: nm(next.bowler) },
    batters: (batId === m.team_a ? aPl : bPl).map((p) => ({ ...p, photo: photoUrl(p.photo_image_id) })),
    bowlers: (bowlId === m.team_a ? aPl : bPl).map((p) => ({ ...p, photo: photoUrl(p.photo_image_id) })),
  };
  return out;
}

// Re-compute match status / result from the balls (after every ball or undo)
async function settle(matchId) {
  const st = await fullState(matchId);
  if (!st) return null;
  const m = st.match;
  if (m.status === 'upcoming') return st;
  let status = 'live', result = null, winner = null;
  if (m.innings === 2) {
    const c = st.cur, wktsLeft = Math.max(1, st.teams[st.secondBat === st.teams.a.id ? 'a' : 'b'].players.length - 1) - c.wkts;
    const chaser = st.teams[st.secondBat === st.teams.a.id ? 'a' : 'b'], setter = st.teams[st.firstBat === st.teams.a.id ? 'a' : 'b'];
    if (c.runs >= m.target) { status = 'finished'; winner = chaser.id; result = `${chaser.name} won by ${wktsLeft} wicket${wktsLeft === 1 ? '' : 's'}`; }
    else if (c.over) {
      status = 'finished';
      if (c.runs === m.target - 1) { result = 'Match tied'; }
      else { winner = setter.id; const d = m.target - 1 - c.runs; result = `${setter.name} won by ${d} run${d === 1 ? '' : 's'}`; }
    }
  }
  await pool.query(`UPDATE cricket_matches SET status = $2, result = $3, winner_id = $4, updated_at = now() WHERE id = $1`, [matchId, status, result, winner]);
  st.match.status = status; st.match.result = result; st.match.winner_id = winner;
  return st;
}

// Small payload for the live-stream score bar (includes player photos)
function barPayload(st) {
  const c = st.cur, bt = st.batTeam === st.teams.a.id ? st.teams.a : st.teams.b, bw = st.batTeam === st.teams.a.id ? st.teams.b : st.teams.a;
  const sId = st.next.striker, nId = st.next.nonStriker;
  const pick = (id) => {
    if (!id) return null;
    const x = c.batters.find((y) => y.id === id), p = st.batters.find((y) => y.id === id);
    return { name: (p && p.name) || '', photo: (p && p.photo) || null, runs: x ? x.runs : 0, balls: x ? x.balls : 0, fours: x ? x.fours : 0, sixes: x ? x.sixes : 0 };
  };
  const bowl = st.next.bowler || st.next.lastBowler;
  const bo = bowl ? c.bowlers.find((y) => y.id === bowl) : null;
  const bp = bowl ? st.bowlers.find((y) => y.id === bowl) : null;
  return {
    show: true, match_id: st.match.id, innings: st.match.innings, status: st.match.status, tournament: st.match.tournament,
    bat: { short: bt.short, name: bt.name }, bowl: { short: bw.short, name: bw.name },
    runs: c.runs, wkts: c.wkts, overs: c.overs, maxOvers: st.match.overs, crr: Number(c.crr.toFixed(2)),
    target: st.match.target, need: c.need, ballsLeft: c.ballsLeft, rrr: c.rrr == null ? null : Number(c.rrr.toFixed(2)),
    first: st.match.innings === 2 ? { short: (st.firstBat === st.teams.a.id ? st.teams.a : st.teams.b).short, runs: st.inn1.runs, wkts: st.inn1.wkts, overs: st.inn1.overs } : null,
    striker: pick(sId), nonStriker: pick(nId),
    bowler: bo || bp ? { name: (bp && bp.name) || '', photo: (bp && bp.photo) || null, wkts: bo ? bo.wkts : 0, runs: bo ? bo.runs : 0, overs: bo ? bo.overs : '0.0' } : null,
    thisOver: c.thisOver, result: st.match.result,
  };
}

// ---------- player career ----------
async function career(playerId) {
  const [bat, outs, bowl] = await Promise.all([
    pool.query(
      `SELECT match_id, innings, SUM(runs_bat)::int AS runs,
              COUNT(*) FILTER (WHERE extra_type IS DISTINCT FROM 'wd')::int AS balls,
              COUNT(*) FILTER (WHERE runs_bat = 4)::int AS fours, COUNT(*) FILTER (WHERE runs_bat = 6)::int AS sixes
         FROM cricket_balls WHERE striker_id = $1 GROUP BY match_id, innings`, [playerId]),
    pool.query(`SELECT COUNT(*)::int AS n FROM cricket_balls WHERE out_id = $1 AND is_wicket AND wicket_type <> 'retired'`, [playerId]),
    pool.query(
      `SELECT match_id, COUNT(*) FILTER (WHERE extra_type IS DISTINCT FROM 'wd' AND extra_type IS DISTINCT FROM 'nb')::int AS legal,
              SUM(runs_bat + CASE WHEN extra_type IN ('wd','nb') THEN extra_runs ELSE 0 END)::int AS runs,
              COUNT(*) FILTER (WHERE is_wicket AND wicket_type = ANY($2::text[]))::int AS wkts
         FROM cricket_balls WHERE bowler_id = $1 GROUP BY match_id`, [playerId, BOWLER_WICKETS]),
  ]);
  const rows = bat.rows;
  const runs = rows.reduce((a, x) => a + x.runs, 0), balls = rows.reduce((a, x) => a + x.balls, 0);
  const dismissals = outs.rows[0].n;
  const hs = rows.reduce((a, x) => Math.max(a, x.runs), 0);
  const bl = bowl.rows;
  const legal = bl.reduce((a, x) => a + x.legal, 0), conceded = bl.reduce((a, x) => a + x.runs, 0), wkts = bl.reduce((a, x) => a + x.wkts, 0);
  let best = null;
  for (const x of bl) if (!best || x.wkts > best.wkts || (x.wkts === best.wkts && x.runs < best.runs)) best = x;
  const matches = new Set([...rows.map((x) => x.match_id), ...bl.map((x) => x.match_id)]).size;
  return {
    matches, innings: rows.length, runs, balls, hs, fours: rows.reduce((a, x) => a + x.fours, 0), sixes: rows.reduce((a, x) => a + x.sixes, 0),
    fifties: rows.filter((x) => x.runs >= 50 && x.runs < 100).length, hundreds: rows.filter((x) => x.runs >= 100).length,
    avg: dismissals ? runs / dismissals : null, notOuts: Math.max(0, rows.length - dismissals), sr: balls ? runs * 100 / balls : 0,
    bowlInnings: bl.length, overs: oversText(legal), conceded, wkts, econ: legal ? conceded * 6 / legal : 0, bowlAvg: wkts ? conceded / wkts : null,
    best: best && (best.wkts || best.legal) ? `${best.wkts}/${best.runs}` : '-',
  };
}

module.exports = { WICKET_TYPES, BOWLER_WICKETS, isLegal, oversText, shortName, summarize, suggestNext, loadMatch, fullState, settle, barPayload, career, teamPlayers };
