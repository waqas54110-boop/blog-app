// Street Cricket Manager (V35/V36): /cricket - tournaments, teams, players (with photos), fixtures, ball-by-ball scorer,
// public live scorecard with embedded live video (WhatsApp share), player career, and the live-stream score bar (/cricket/bar/:streamId).
const express = require('express');
const pool = require('../db');
const config = require('../config');
const C = require('../lib/cricket');
const cloud = require('../lib/cloudinary');
const { detectImage } = require('./uploads');

const router = express.Router();
const toId = (v) => (/^\d{1,9}$/.test(String(v)) ? parseInt(v, 10) : null);
const oneLine = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const baseUrl = (req) => config.siteUrl || `${req.protocol}://${req.get('host')}`;
const isAdmin = (req) => !!(req.session.user && req.session.user.role === 'admin');
const LIMITS = { tournaments: 20, teams: 16, perTeam: 20, matches: 120 };

const wrapPage = (fn) => (req, res, next) => fn(req, res, next).catch((err) => {
  if (err && err.code === '42P01') {
    return res.status(503).render('404', { code: 503, title: 'Cricket not set up', message: 'The site owner needs to run migration_v35.sql first.' });
  }
  next(err);
});
const wrapJson = (fn) => (req, res) => fn(req, res).catch((err) => {
  if (err && err.code === '42P01') return res.status(503).json({ error: 'Cricket is not set up yet (migration_v35.sql).' });
    if (err && err.code === '42703') return res.status(503).json({ error: 'Player photos are not set up yet (run migration_v36.sql).' });
  console.error('[cricket]', err.message);
  if (!res.headersSent) res.status(500).json({ error: 'Server error, please try again.' });
});
const needLogin = (req, res) => { req.session.returnTo = req.originalUrl; res.redirect('/login'); };
const denied = (res, msg) => res.status(403).render('404', { code: 403, title: 'Not allowed', message: msg || 'Only the tournament organizer can do this.' });
const back = (res, path, kind, text) => res.redirect(`${path}?${kind}=${encodeURIComponent(text)}`);

// Small cache: many viewers poll the same match (up to 200 on a live stream)
const cache = new Map();
async function cachedState(id, ttl = 2000) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.t < ttl) return hit.st;
  const st = await C.fullState(id);
  cache.set(id, { t: Date.now(), st });
  if (cache.size > 300) for (const k of cache.keys()) { cache.delete(k); if (cache.size < 200) break; }
  return st;
}
const bust = (id) => cache.delete(id);

// Is anyone streaming for this match right now? Either the organizer or the assigned scorer can be the one who is live.
const streamCache = new Map();
async function matchStream(m) {
  const key = `${m.owner_id}:${m.scorer_id || 0}`;
  const hit = streamCache.get(key);
  if (hit && Date.now() - hit.t < 2000) return hit.v;
  let v = null;
  try {
    const r = await pool.query(
      `SELECT s.id, s.user_id, u.username FROM live_streams s JOIN users u ON u.id = s.user_id
       WHERE s.user_id = ANY($1::int[]) AND s.status = 'live' AND s.host_seen > now() - interval '25 seconds' ORDER BY s.id DESC LIMIT 1`,
      [[m.owner_id, m.scorer_id || m.owner_id]]);
    if (r.rows[0]) v = { id: Number(r.rows[0].id), host: r.rows[0].username, uid: r.rows[0].user_id };
  } catch (e) { v = null; } // live tables missing (migration_v27 not run): simply no video
  streamCache.set(key, { t: Date.now(), v });
  if (streamCache.size > 300) streamCache.clear();
  return v;
}
const ownerStreaming = async (m) => !!(await matchStream(m));
// What the browser gets: the stream id + host name, and whether the viewer is the one streaming
const pubStream = (req, s) => (s ? { id: s.id, host: s.host, mine: !!(req.session.user && req.session.user.id === s.uid) } : null);

// Queries that read the photo column keep working before migration_v36.sql is run (they just return no photos).
let hasPhotoCol = true;
async function qPhoto(withSql, withoutSql, params) {
  if (hasPhotoCol) { try { return await pool.query(withSql, params); } catch (e) { if (e.code !== '42703') throw e; hasPhotoCol = false; } }
  return pool.query(withoutSql, params);
}
const canManage = (req, ownerId) => !!req.session.user && (req.session.user.id === ownerId || isAdmin(req));
const canScore = (req, m) => !!req.session.user && (req.session.user.id === m.owner_id || req.session.user.id === m.scorer_id || isAdmin(req));

function parseNames(text) {
  const seen = new Set(), out = [];
  for (const raw of String(text || '').split(/[\n,]+/)) {
    const n = oneLine(raw, 40);
    if (n.length < 2 || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase()); out.push(n);
    if (out.length >= LIMITS.perTeam) break;
  }
  return out;
}
async function addPlayers(owner, teamId, names) {
  let added = 0;
  const have = (await pool.query('SELECT COUNT(*)::int AS n FROM cricket_team_players WHERE team_id = $1', [teamId])).rows[0].n;
  for (const name of names.slice(0, Math.max(0, LIMITS.perTeam - have))) {
    const p = await pool.query(
      `INSERT INTO cricket_players (owner_id, name) VALUES ($1, $2)
       ON CONFLICT (owner_id, lower(name)) DO UPDATE SET name = cricket_players.name RETURNING id`, [owner, name]);
    const r = await pool.query('INSERT INTO cricket_team_players (team_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [teamId, p.rows[0].id]);
    added += r.rowCount;
  }
  return added;
}

const MATCH_SQL = `SELECT m.id, m.tournament_id, m.status, m.result, m.overs, m.innings, m.scheduled_at, m.show_on_stream, m.updated_at, m.winner_id, m.team_a, m.team_b,
        ta.name AS a_name, tb.name AS b_name, t.name AS t_name, t.owner_id
   FROM cricket_matches m JOIN cricket_teams ta ON ta.id = m.team_a JOIN cricket_teams tb ON tb.id = m.team_b JOIN cricket_tournaments t ON t.id = m.tournament_id`;

// ---------- HUB ----------
router.get('/cricket', wrapPage(async (req, res) => {
  const me = req.session.user;
  const [liveQ, recentQ, tq, mine] = await Promise.all([
    pool.query(`${MATCH_SQL} WHERE m.status = 'live' ORDER BY m.updated_at DESC LIMIT 8`),
    pool.query(`${MATCH_SQL} WHERE m.status = 'finished' ORDER BY m.updated_at DESC LIMIT 8`),
    pool.query(`SELECT t.id, t.name, t.city, t.overs, u.username,
                       (SELECT COUNT(*)::int FROM cricket_teams x WHERE x.tournament_id = t.id) AS teams,
                       (SELECT COUNT(*)::int FROM cricket_matches x WHERE x.tournament_id = t.id) AS matches
                  FROM cricket_tournaments t JOIN users u ON u.id = t.owner_id ORDER BY t.id DESC LIMIT 12`),
    me ? pool.query('SELECT id, name, city, overs FROM cricket_tournaments WHERE owner_id = $1 ORDER BY id DESC', [me.id]) : { rows: [] },
  ]);
  const live = [];
  for (const m of liveQ.rows) {
    const st = await cachedState(m.id, 4000);
    const c = st.cur, bt = st.batTeam === st.teams.a.id ? st.teams.a : st.teams.b;
    live.push({ ...m, score: `${bt.name} ${c.runs}/${c.wkts} (${c.overs})`, chase: st.match.target ? `Target ${st.match.target}` : '' });
  }
  res.render('cricket', {
    title: 'Street Cricket Manager - live scores, tournaments & player stats | Khabzo',
    metaDescription: 'Score your street and club cricket ball by ball, stream it live with a score bar, share the live scorecard on WhatsApp, and build every player\'s career profile.',
    live, recent: recentQ.rows, tournaments: tq.rows, mine: mine.rows, err: oneLine(req.query.err, 160), ok: oneLine(req.query.ok, 160),
  });
}));

router.post('/cricket', wrapPage(async (req, res) => {
  const me = req.session.user;
  if (!me) return needLogin(req, res);
  const name = oneLine(req.body.name, 80), city = oneLine(req.body.city, 60);
  const overs = Math.min(Math.max(parseInt(req.body.overs, 10) || 6, 1), 50);
  if (name.length < 3) return back(res, '/cricket', 'err', 'Give the tournament a name (at least 3 letters).');
  const n = (await pool.query('SELECT COUNT(*)::int AS n FROM cricket_tournaments WHERE owner_id = $1', [me.id])).rows[0].n;
  if (n >= LIMITS.tournaments) return back(res, '/cricket', 'err', `You can run up to ${LIMITS.tournaments} tournaments.`);
  const r = await pool.query('INSERT INTO cricket_tournaments (owner_id, name, city, overs) VALUES ($1, $2, $3, $4) RETURNING id', [me.id, name, city, overs]);
  res.redirect(`/cricket/t/${r.rows[0].id}?ok=${encodeURIComponent('Tournament created. Now add your teams.')}`);
}));

// ---------- TOURNAMENT ----------
async function loadTournament(id) {
  return (await pool.query('SELECT t.*, u.username AS owner_name FROM cricket_tournaments t JOIN users u ON u.id = t.owner_id WHERE t.id = $1', [id])).rows[0] || null;
}

router.get('/cricket/t/:id', wrapPage(async (req, res, next) => {
  const id = toId(req.params.id);
  const t = id && await loadTournament(id);
  if (!t) return next();
  const [teams, pl, ms] = await Promise.all([
    pool.query('SELECT id, name FROM cricket_teams WHERE tournament_id = $1 ORDER BY id', [id]),
    qPhoto(`SELECT tp.team_id, p.id, p.name, p.photo_image_id FROM cricket_team_players tp JOIN cricket_players p ON p.id = tp.player_id
            JOIN cricket_teams x ON x.id = tp.team_id WHERE x.tournament_id = $1 ORDER BY p.name`,
      `SELECT tp.team_id, p.id, p.name, NULL::int AS photo_image_id FROM cricket_team_players tp JOIN cricket_players p ON p.id = tp.player_id
            JOIN cricket_teams x ON x.id = tp.team_id WHERE x.tournament_id = $1 ORDER BY p.name`, [id]),
    pool.query(`${MATCH_SQL} WHERE m.tournament_id = $1 ORDER BY m.id`, [id]),
  ]);
  const table = teams.rows.map((x) => ({ id: x.id, name: x.name, p: 0, w: 0, l: 0, t: 0, pts: 0 }));
  const by = new Map(table.map((x) => [x.id, x]));
  for (const m of ms.rows) {
    if (m.status !== 'finished') continue;
    const a = by.get(m.team_a), b = by.get(m.team_b);
    if (!a || !b) continue;
    a.p++; b.p++;
    if (!m.winner_id) { a.t++; b.t++; a.pts++; b.pts++; }
    else { const w = by.get(m.winner_id), l = m.winner_id === m.team_a ? b : a; w.w++; w.pts += 2; l.l++; }
  }
  table.sort((x, y) => y.pts - x.pts || y.w - x.w || x.name.localeCompare(y.name));
  res.render('cricket-tournament', {
    title: `${t.name} - fixtures, points table & live scores | Khabzo`,
    metaDescription: `${t.name}${t.city ? ' (' + t.city + ')' : ''}: ${teams.rowCount} teams, ${t.overs}-over matches. Live scorecards and player stats.`,
    t, teams: teams.rows, players: pl.rows, matches: ms.rows, table, manage: canManage(req, t.owner_id), base: baseUrl(req),
    err: oneLine(req.query.err, 160), ok: oneLine(req.query.ok, 160),
  });
}));

// Tournament POST routes: organizer only
async function ownT(req, res) {
  const me = req.session.user;
  if (!me) { needLogin(req, res); return null; }
  const id = toId(req.params.id);
  const t = id && await loadTournament(id);
  if (!t) { res.status(404).render('404', { title: 'Not Found' }); return null; }
  if (!canManage(req, t.owner_id)) { denied(res); return null; }
  return t;
}

router.post('/cricket/t/:id/teams', wrapPage(async (req, res) => {
  const t = await ownT(req, res); if (!t) return;
  const path = `/cricket/t/${t.id}`;
  const name = oneLine(req.body.name, 40);
  if (name.length < 2) return back(res, path, 'err', 'Team name is too short.');
  const n = (await pool.query('SELECT COUNT(*)::int AS n FROM cricket_teams WHERE tournament_id = $1', [t.id])).rows[0].n;
  if (n >= LIMITS.teams) return back(res, path, 'err', `A tournament can have up to ${LIMITS.teams} teams.`);
  const r = await pool.query('INSERT INTO cricket_teams (tournament_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id', [t.id, name]);
  if (!r.rowCount) return back(res, path, 'err', 'A team with this name already exists.');
  await addPlayers(t.owner_id, r.rows[0].id, parseNames(req.body.players));
  back(res, path, 'ok', `${name} added.`);
}));

router.post('/cricket/t/:id/teams/:tid/players', wrapPage(async (req, res) => {
  const t = await ownT(req, res); if (!t) return;
  const tid = toId(req.params.tid);
  const ok = tid && (await pool.query('SELECT 1 FROM cricket_teams WHERE id = $1 AND tournament_id = $2', [tid, t.id])).rowCount;
  if (!ok) return back(res, `/cricket/t/${t.id}`, 'err', 'Team not found.');
  const added = await addPlayers(t.owner_id, tid, parseNames(req.body.players));
  back(res, `/cricket/t/${t.id}`, added ? 'ok' : 'err', added ? `${added} player${added === 1 ? '' : 's'} added.` : `No new players added (max ${LIMITS.perTeam} per team, duplicates skipped).`);
}));

router.post('/cricket/t/:id/teams/:tid/players/:pid/remove', wrapPage(async (req, res) => {
  const t = await ownT(req, res); if (!t) return;
  const tid = toId(req.params.tid), pid = toId(req.params.pid);
  if (tid && pid) {
    const used = await pool.query(
      `SELECT 1 FROM cricket_matches m WHERE (m.team_a = $1 OR m.team_b = $1) AND m.status <> 'upcoming' AND m.tournament_id = $2 LIMIT 1`, [tid, t.id]);
    if (used.rowCount) return back(res, `/cricket/t/${t.id}`, 'err', 'This team has already started a match, so its squad is locked.');
    await pool.query(`DELETE FROM cricket_team_players WHERE team_id = $1 AND player_id = $2
                      AND EXISTS (SELECT 1 FROM cricket_teams x WHERE x.id = $1 AND x.tournament_id = $3)`, [tid, pid, t.id]);
  }
  res.redirect(`/cricket/t/${t.id}`);
}));

router.post('/cricket/t/:id/teams/:tid/delete', wrapPage(async (req, res) => {
  const t = await ownT(req, res); if (!t) return;
  const tid = toId(req.params.tid);
  if (tid) {
    const used = await pool.query('SELECT 1 FROM cricket_matches WHERE team_a = $1 OR team_b = $1 LIMIT 1', [tid]);
    if (used.rowCount) return back(res, `/cricket/t/${t.id}`, 'err', 'Delete this team\'s fixtures first.');
    await pool.query('DELETE FROM cricket_teams WHERE id = $1 AND tournament_id = $2', [tid, t.id]);
  }
  res.redirect(`/cricket/t/${t.id}`);
}));

async function matchCount(tid) { return (await pool.query('SELECT COUNT(*)::int AS n FROM cricket_matches WHERE tournament_id = $1', [tid])).rows[0].n; }

router.post('/cricket/t/:id/fixtures', wrapPage(async (req, res) => {
  const t = await ownT(req, res); if (!t) return;
  const path = `/cricket/t/${t.id}`;
  const a = toId(req.body.team_a), b = toId(req.body.team_b);
  if (!a || !b || a === b) return back(res, path, 'err', 'Pick two different teams.');
  const ok = (await pool.query('SELECT COUNT(*)::int AS n FROM cricket_teams WHERE tournament_id = $1 AND id = ANY($2::int[])', [t.id, [a, b]])).rows[0].n === 2;
  if (!ok) return back(res, path, 'err', 'Team not found.');
  if ((await matchCount(t.id)) >= LIMITS.matches) return back(res, path, 'err', 'Too many fixtures in this tournament.');
  const overs = Math.min(Math.max(parseInt(req.body.overs, 10) || t.overs, 1), 50);
  let when = null;
  if (req.body.when) { const d = new Date(req.body.when); if (!isNaN(d)) when = d; }
  await pool.query('INSERT INTO cricket_matches (tournament_id, team_a, team_b, overs, scheduled_at) VALUES ($1, $2, $3, $4, $5)', [t.id, a, b, overs, when]);
  back(res, path, 'ok', 'Fixture added.');
}));

router.post('/cricket/t/:id/fixtures/auto', wrapPage(async (req, res) => {
  const t = await ownT(req, res); if (!t) return;
  const path = `/cricket/t/${t.id}`;
  const teams = (await pool.query('SELECT id FROM cricket_teams WHERE tournament_id = $1 ORDER BY id', [t.id])).rows.map((x) => x.id);
  if (teams.length < 2) return back(res, path, 'err', 'Add at least two teams first.');
  const have = new Set((await pool.query('SELECT team_a, team_b FROM cricket_matches WHERE tournament_id = $1', [t.id])).rows.map((x) => [x.team_a, x.team_b].sort().join('-')));
  let room = LIMITS.matches - await matchCount(t.id), made = 0;
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      if (room <= 0 || have.has([teams[i], teams[j]].sort().join('-'))) continue;
      await pool.query('INSERT INTO cricket_matches (tournament_id, team_a, team_b, overs) VALUES ($1, $2, $3, $4)', [t.id, teams[i], teams[j], t.overs]);
      made++; room--;
    }
  }
  back(res, path, made ? 'ok' : 'err', made ? `${made} fixture${made === 1 ? '' : 's'} created (everyone plays everyone once).` : 'All fixtures already exist.');
}));

router.post('/cricket/t/:id/delete', wrapPage(async (req, res) => {
  const t = await ownT(req, res); if (!t) return;
  await pool.query('DELETE FROM cricket_tournaments WHERE id = $1', [t.id]);
  res.redirect('/cricket?ok=' + encodeURIComponent('Tournament deleted.'));
}));

router.post('/cricket/m/:id/delete', wrapPage(async (req, res, next) => {
  const me = req.session.user;
  if (!me) return needLogin(req, res);
  const id = toId(req.params.id);
  const m = id && await C.loadMatch(id);
  if (!m) return next();
  if (!canManage(req, m.owner_id)) return denied(res);
  await pool.query('DELETE FROM cricket_matches WHERE id = $1', [id]);
  bust(id);
  res.redirect(`/cricket/t/${m.tournament_id}`);
}));

// ---------- PUBLIC SCORECARD ----------
router.get('/cricket/m/:id', wrapPage(async (req, res, next) => {
  const id = toId(req.params.id);
  const st = id && await cachedState(id, 1000);
  if (!st) return next();
  const A = st.teams.a.name, B = st.teams.b.name, c = st.cur;
  const bt = st.batTeam === st.teams.a.id ? A : B;
  const summary = st.match.status === 'upcoming' ? `${A} vs ${B} - match not started yet.`
    : st.match.result ? `${A} vs ${B}: ${st.match.result}.` : `${bt} ${c.runs}/${c.wkts} (${c.overs} ov)${st.match.target ? ', target ' + st.match.target : ''}. Live score.`;
  const url = `${baseUrl(req)}/cricket/m/${id}`;
  res.render('cricket-match', {
    title: `${A} vs ${B} - ${st.match.status === 'live' ? 'LIVE score' : 'scorecard'} | ${st.match.tournament}`,
    metaDescription: summary, ogType: 'article', st, summary, shareUrl: url,
    shareText: `🏏 ${A} vs ${B}${st.match.status === 'live' ? ` - LIVE: ${bt} ${c.runs}/${c.wkts} (${c.overs})` : st.match.result ? ' - ' + st.match.result : ''}\nLive scorecard: ${url}`,
    canScore: !!(req.session.user && canScore(req, { owner_id: st.match.owner_id, scorer_id: st.match.scorer_id })),
    stream: st.match.show_on_stream ? pubStream(req, await matchStream(st.match)) : null,
  });
}));

router.get('/cricket/m/:id/state.json', wrapJson(async (req, res) => {
  const id = toId(req.params.id);
  const st = id && await cachedState(id);
  if (!st) return res.status(404).json({ error: 'Match not found.' });
  res.set('Cache-Control', 'no-store');
  res.json({ ...st, stream: st.match.show_on_stream ? pubStream(req, await matchStream(st.match)) : null });
}));

// ---------- SCORER ----------
async function scorerMatch(req, res, json) {
  const me = req.session.user;
  if (!me) { if (json) res.status(401).json({ error: 'Please log in again.' }); else needLogin(req, res); return null; }
  const id = toId(req.params.id);
  const m = id && await C.loadMatch(id);
  if (!m) { if (json) res.status(404).json({ error: 'Match not found.' }); else res.status(404).render('404', { title: 'Not Found' }); return null; }
  if (!canScore(req, m)) { if (json) res.status(403).json({ error: 'Only the organizer or the scorer can do this.' }); else denied(res, 'Only the organizer or the assigned scorer can score this match.'); return null; }
  return m;
}
const reply = async (res, id, extra = {}) => {
  bust(id);
  const st = await C.settle(id);
  bust(id);
  const m = st.match;
  streamCache.clear();
  res.json({ ok: true, state: st, streaming: await ownerStreaming(m), ...extra });
};

router.get('/cricket/m/:id/score', wrapPage(async (req, res, next) => {
  const m = await scorerMatch(req, res, false); if (!m) return;
  const st = await C.fullState(m.id);
  res.render('cricket-score', {
    title: `Score: ${m.a_name} vs ${m.b_name} | Khabzo`, robots: 'noindex,nofollow', hideNewsBar: true,
    st, streaming: await ownerStreaming(m), isOwner: canManage(req, m.owner_id), shareUrl: `${baseUrl(req)}/cricket/m/${m.id}`,
  });
}));

router.post('/cricket/m/:id/start', wrapJson(async (req, res) => {
  const m = await scorerMatch(req, res, true); if (!m) return;
  if (m.status !== 'upcoming') return res.status(409).json({ error: 'This match has already started.' });
  const winner = toId(req.body.toss_winner), choice = req.body.toss_choice === 'bowl' ? 'bowl' : 'bat';
  if (winner !== m.team_a && winner !== m.team_b) return res.status(400).json({ error: 'Pick who won the toss.' });
  const pl = await C.teamPlayers([m.team_a, m.team_b]);
  const na = pl.filter((p) => p.team_id === m.team_a).length, nb = pl.filter((p) => p.team_id === m.team_b).length;
  if (na < 2 || nb < 2) return res.status(400).json({ error: 'Each team needs at least 2 players. Add players on the tournament page.' });
  const bat = choice === 'bat' ? winner : (winner === m.team_a ? m.team_b : m.team_a);
  await pool.query(`UPDATE cricket_matches SET status = 'live', toss_winner = $2, toss_choice = $3, bat_team = $4, innings = 1, updated_at = now() WHERE id = $1`, [m.id, winner, choice, bat]);
  await reply(res, m.id);
}));

router.post('/cricket/m/:id/ball', wrapJson(async (req, res) => {
  const m = await scorerMatch(req, res, true); if (!m) return;
  const st = await C.fullState(m.id);
  if (st.match.status !== 'live') return res.status(409).json({ error: st.match.status === 'finished' ? 'This match is finished.' : 'Start the match first (toss).' });
  if (st.cur.over) return res.status(409).json({ error: 'This innings is over.' });

  const b = req.body || {};
  const striker = toId(b.striker), non = toId(b.nonStriker), bowler = toId(b.bowler);
  const batIds = new Set(st.batters.map((p) => p.id)), bowlIds = new Set(st.bowlers.map((p) => p.id));
  if (!striker || !non || striker === non || !batIds.has(striker) || !batIds.has(non)) return res.status(400).json({ error: 'Pick the striker and the non-striker (two different batters).' });
  if (!bowler || !bowlIds.has(bowler)) return res.status(400).json({ error: 'Pick the bowler.' });
  const outAlready = new Set(st.cur.batters.filter((x) => x.out).map((x) => x.id));
  if (outAlready.has(striker) || outAlready.has(non)) return res.status(400).json({ error: 'A batter who is already out cannot bat again.' });

  const runs = Number.isInteger(b.runs) ? b.runs : parseInt(b.runs, 10);
  if (!(runs >= 0 && runs <= 7)) return res.status(400).json({ error: 'Runs must be 0 to 7.' });
  const extra = ['wd', 'nb', 'b', 'lb'].includes(b.extra) ? b.extra : null;
  let runsBat = 0, extraRuns = 0;
  if (!extra) runsBat = runs;
  else if (extra === 'nb') { runsBat = runs; extraRuns = 1; }
  else if (extra === 'wd') extraRuns = 1 + runs;
  else extraRuns = runs;

  let isW = false, wType = null, outId = null;
  if (b.wicket && b.wicket.type) {
    wType = String(b.wicket.type);
    if (!C.WICKET_TYPES.includes(wType) || wType === 'retired') return res.status(400).json({ error: 'Unknown wicket type.' });
    if (extra === 'nb' && wType !== 'runout') return res.status(400).json({ error: 'Only a run out is possible on a no-ball.' });
    if (extra === 'wd' && !['runout', 'stumped', 'hitwicket'].includes(wType)) return res.status(400).json({ error: 'On a wide only run out, stumped or hit wicket is possible.' });
    if ((extra === 'b' || extra === 'lb') && wType !== 'runout') return res.status(400).json({ error: 'Only a run out is possible on byes / leg byes.' });
    isW = true;
    outId = (wType === 'runout' && b.wicket.out === 'nonStriker') ? non : striker;
  }
  await pool.query(
    `INSERT INTO cricket_balls (match_id, innings, striker_id, non_striker_id, bowler_id, runs_bat, extra_type, extra_runs, is_wicket, wicket_type, out_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [m.id, st.match.innings, striker, non, bowler, runsBat, extra, extraRuns, isW, wType, outId]);
  await reply(res, m.id);
}));

router.post('/cricket/m/:id/undo', wrapJson(async (req, res) => {
  const m = await scorerMatch(req, res, true); if (!m) return;
  if (m.status === 'upcoming') return res.status(409).json({ error: 'Nothing to undo.' });
  const last = (await pool.query('SELECT id FROM cricket_balls WHERE match_id = $1 AND innings = $2 ORDER BY id DESC LIMIT 1', [m.id, m.innings])).rows[0];
  if (last) await pool.query('DELETE FROM cricket_balls WHERE id = $1', [last.id]);
  else if (m.innings === 2) await pool.query('UPDATE cricket_matches SET innings = 1, bat_team = $2 WHERE id = $1', [m.id, (await C.fullState(m.id)).firstBat]);
  else return res.status(409).json({ error: 'Nothing to undo.' });
  await reply(res, m.id);
}));

router.post('/cricket/m/:id/innings2', wrapJson(async (req, res) => {
  const m = await scorerMatch(req, res, true); if (!m) return;
  const st = await C.fullState(m.id);
  if (st.match.status !== 'live' || st.match.innings !== 1) return res.status(409).json({ error: 'The 2nd innings cannot be started now.' });
  if (!st.cur.over && !req.body.force) return res.status(409).json({ error: 'The 1st innings is not over yet.' });
  await pool.query('UPDATE cricket_matches SET innings = 2, bat_team = $2, target = $3, updated_at = now() WHERE id = $1', [m.id, st.secondBat, st.inn1.runs + 1]);
  await reply(res, m.id);
}));

router.post('/cricket/m/:id/stream', wrapJson(async (req, res) => {
  const m = await scorerMatch(req, res, true); if (!m) return;
  const show = req.body.show === true || req.body.show === 'true' || req.body.show === 1;
  await pool.query('UPDATE cricket_matches SET show_on_stream = $2, updated_at = now() WHERE id = $1', [m.id, show]);
  await reply(res, m.id);
}));

router.post('/cricket/m/:id/scorer', wrapJson(async (req, res) => {
  const m = await scorerMatch(req, res, true); if (!m) return;
  if (!canManage(req, m.owner_id)) return res.status(403).json({ error: 'Only the organizer can change the scorer.' });
  const uname = oneLine(req.body.username, 40);
  if (!uname) { await pool.query('UPDATE cricket_matches SET scorer_id = NULL WHERE id = $1', [m.id]); return reply(res, m.id); }
  const u = (await pool.query('SELECT id FROM users WHERE lower(username) = lower($1)', [uname])).rows[0];
  if (!u) return res.status(404).json({ error: 'No user with that username.' });
  await pool.query('UPDATE cricket_matches SET scorer_id = $2 WHERE id = $1', [m.id, u.id]);
  await reply(res, m.id);
}));

// ---------- LIVE STREAM SCORE BAR ----------
// The screen that hosts or watches a stream polls this. The bar is returned only when: the organizer (or the assigned scorer) is live
// right now AND this match's "Show on live stream" switch is ON. Otherwise {show:false} (no bar).
router.get('/cricket/bar/:streamId', wrapJson(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const sid = toId(req.params.streamId);
  if (!sid) return res.json({ show: false });
  const r = await pool.query(
    `SELECT m.id FROM cricket_matches m JOIN cricket_tournaments t ON t.id = m.tournament_id JOIN live_streams s ON (s.user_id = t.owner_id OR s.user_id = m.scorer_id)
      WHERE s.id = $1 AND s.status = 'live' AND m.show_on_stream
        AND (m.status = 'live' OR (m.status = 'finished' AND m.updated_at > now() - interval '10 minutes'))
      ORDER BY m.updated_at DESC LIMIT 1`, [sid]);
  if (!r.rowCount) return res.json({ show: false });
  const st = await cachedState(r.rows[0].id);
  res.json(st ? C.barPayload(st) : { show: false });
}));

// ---------- PLAYER PHOTOS ----------
// The browser crops the picture to a 256x256 JPEG and sends the raw bytes (express.raw in app.js, CSRF token in the x-csrf-token header).
// The photo is shown on the live score bar, the scorecard and the player's career page.
async function photoPlayer(req, res) {
  const me = req.session.user;
  if (!me) { res.status(401).json({ error: 'Please log in again.' }); return null; }
  const id = toId(req.params.id);
  const p = id && (await pool.query('SELECT id, owner_id FROM cricket_players WHERE id = $1', [id])).rows[0];
  if (!p) { res.status(404).json({ error: 'Player not found.' }); return null; }
  if (!canManage(req, p.owner_id)) { res.status(403).json({ error: 'Only the organizer can change player photos.' }); return null; }
  return p;
}
async function dropPhoto(imageId) { if (imageId) await pool.query('DELETE FROM images WHERE id = $1', [imageId]).catch(() => {}); }

router.post('/cricket/players/:id/photo', wrapJson(async (req, res) => {
  const p = await photoPlayer(req, res); if (!p) return;
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length === 0) return res.status(400).json({ error: 'Please choose an image.' });
  if (detectImage(buf) !== 'image/jpeg') return res.status(400).json({ error: 'Only JPG images are accepted here.' });
  let remote = null;
  if (cloud.enabled()) {
    try { remote = (await cloud.uploadImage(buf, 'image/jpeg')).url; } catch (e) { console.error('[cricket photo] Cloudinary failed, saving in the database instead:', e.message); }
  }
  const old = (await pool.query('SELECT photo_image_id FROM cricket_players WHERE id = $1', [p.id])).rows[0];
  const ins = await pool.query('INSERT INTO images (mime, data, size, uploaded_by, remote_url) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    ['image/jpeg', remote ? null : buf, buf.length, req.session.user.id, remote]);
  await pool.query('UPDATE cricket_players SET photo_image_id = $2 WHERE id = $1', [p.id, ins.rows[0].id]);
  await dropPhoto(old && old.photo_image_id);
  cache.clear();
  res.json({ ok: true, url: `/img/${ins.rows[0].id}` });
}));

router.post('/cricket/players/:id/photo/remove', wrapJson(async (req, res) => {
  const p = await photoPlayer(req, res); if (!p) return;
  const old = (await pool.query('SELECT photo_image_id FROM cricket_players WHERE id = $1', [p.id])).rows[0];
  await pool.query('UPDATE cricket_players SET photo_image_id = NULL WHERE id = $1', [p.id]);
  await dropPhoto(old && old.photo_image_id);
  cache.clear();
  res.json({ ok: true });
}));

// ---------- PLAYER CAREER ----------
router.get('/cricket/p/:id', wrapPage(async (req, res, next) => {
  const id = toId(req.params.id);
  const teamsSql = "(SELECT string_agg(DISTINCT t.name, ', ') FROM cricket_team_players tp JOIN cricket_teams t ON t.id = tp.team_id WHERE tp.player_id = p.id) AS teams";
  const p = id && (await qPhoto(
    `SELECT p.id, p.name, p.owner_id, p.photo_image_id, u.username AS owner, ${teamsSql} FROM cricket_players p JOIN users u ON u.id = p.owner_id WHERE p.id = $1`,
    `SELECT p.id, p.name, p.owner_id, NULL::int AS photo_image_id, u.username AS owner, ${teamsSql} FROM cricket_players p JOIN users u ON u.id = p.owner_id WHERE p.id = $1`,
    [id])).rows[0];
  if (!p) return next();
  const s = await C.career(id);
  res.render('cricket-player', {
    title: `${p.name} - cricket career: ${s.runs} runs, ${s.wkts} wickets | Khabzo`,
    metaDescription: `${p.name}: ${s.matches} matches, ${s.runs} runs (SR ${s.sr.toFixed(1)}), ${s.wkts} wickets.`, p, s,
    ogImage: p.photo_image_id ? `${baseUrl(req)}/img/${p.photo_image_id}` : null,
    manage: canManage(req, p.owner_id),
  });
}));

module.exports = router;
