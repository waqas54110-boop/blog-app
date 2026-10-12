// Ludo (V60): online multiplayer (2-4 players, bots can fill empty seats). Server decides everything (dice, legal moves,
// captures, turn timer), browsers only poll /ludo/:code/state.json and send "roll" / "move" actions.
//
// Token position (per token): -1 = in the yard, 0..50 = steps on the shared 52-cell track (0 = own start cell),
// 51..55 = own home column, 56 = home (finished).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../db');

const START = [0, 13, 26, 39];               // track index where red / green / yellow / blue enter
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]); // start cells + star cells: no capture here
const HOME = 56;
const HUMAN_MS = 30000;                       // time to roll / move before the game plays for you
const AUTO_MS = 900;                          // pause so everyone can see the dice before a bot / single move happens
const NEXT_MS = 1300;                         // pause after a turn passes (let the animation finish)
const MAX_ACTIVE = 3;                         // a user can be in at most this many live games
const COLOR_NAMES = ['Red', 'Green', 'Yellow', 'Blue'];
const BOT_NAMES = ['Bot Ali', 'Bot Sara', 'Bot Hamza', 'Bot Zara', 'Bot Bilal', 'Bot Noor'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// V61 chat: text + quick emojis. Messages live inside the game state (last CHAT_KEEP only), so no new table is needed.
const CHAT_EMOJIS = ['\u{1F602}', '\u{1F60E}', '\u{1F621}', '\u{1F44D}', '\u{1F62D}', '\u{1F525}', '\u{1F389}', '\u{1F914}'];  // 😂 😎 😡 👍 😭 🔥 🎉 🤔
const CHAT_MAX_LEN = 140;     // characters per message
const CHAT_KEEP = 40;         // messages kept per room
const CHAT_GAP_MS = 800;      // minimum gap between two messages from the same player

// ---------- Board geometry (15 x 15 grid, [row, col]), clockwise from red's start cell ----------
const TRACK_RC = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  [0, 7], [0, 8],
  [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  [7, 14], [8, 14],
  [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7], [14, 6],
  [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  [7, 0], [6, 0],
];
const HOME_RC = [
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],       // red
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],       // green
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],   // yellow
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],   // blue
];
const YARD_ORIGIN = [[0, 0], [0, 9], [9, 9], [9, 0]]; // [row, col] of each 6x6 yard
const ctr = ([r, c]) => [c + 0.5, r + 0.5];            // cell -> centre in grid units [x, y]
const BOARD = {
  track: TRACK_RC.map(ctr),
  home: HOME_RC.map((col) => col.map(ctr)),
  yards: YARD_ORIGIN.map(([r, c]) => [[c + 2, r + 2], [c + 4, r + 2], [c + 2, r + 4], [c + 4, r + 4]]),
  finish: [[6.55, 7.5], [7.5, 6.55], [8.45, 7.5], [7.5, 8.45]],
  start: START,
  safe: [...SAFE],
};

const absIdx = (color, rel) => (rel >= 0 && rel <= 50 ? (START[color] + rel) % 52 : -1);
const colorsFor = (n) => (n === 2 ? [0, 2] : [0, 1, 2, 3].slice(0, n));
const oneLine = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// ---------- Pure game rules ----------
function newState(userId, name) {
  return {
    status: 'waiting',
    players: [{ userId, name: oneLine(name, 50), bot: false, left: false, afk: 0, color: null }],
    tokens: null, turn: 0, phase: 'roll', dice: null, sixes: 0, legal: [],
    deadline: 0, nextAt: 0, seq: 0, last: null, winner: null, abandoned: false, rematch: null,
    chat: [], chatSeq: 0,
  };
}

function startGame(state, now) {
  const cols = colorsFor(state.players.length);
  state.players.forEach((p, i) => { p.color = cols[i]; p.afk = 0; });
  state.tokens = state.players.map(() => [-1, -1, -1, -1]);
  state.status = 'playing';
  state.turn = crypto.randomInt(0, state.players.length);
  state.phase = 'roll'; state.dice = null; state.sixes = 0; state.legal = [];
  state.deadline = now + HUMAN_MS + 2000; state.nextAt = now + NEXT_MS;
  state.last = null; state.winner = null; state.abandoned = false;
}

// One token per distinct position (4 tokens in the yard are the same move)
function legalMoves(state, pi, dice) {
  const out = []; const seen = new Set();
  state.tokens[pi].forEach((pos, t) => {
    if (pos === HOME || seen.has(pos)) return;
    if (pos === -1) { if (dice !== 6) return; } else if (pos + dice > HOME) return;
    seen.add(pos); out.push(t);
  });
  return out;
}

function passTurn(state, now) {
  state.sixes = 0;
  state.turn = (state.turn + 1) % state.players.length;
  state.phase = 'roll'; state.legal = [];
  state.deadline = now + HUMAN_MS + 1500; state.nextAt = now + NEXT_MS;
}

function doRoll(state, now) {
  const pi = state.turn;
  const dice = crypto.randomInt(1, 7);
  state.dice = dice;
  state.sixes = dice === 6 ? state.sixes + 1 : 0;
  state.last = { id: ++state.seq, p: pi, dice, move: null, captured: [], note: null };
  if (state.sixes >= 3) { state.last.note = 'three6'; passTurn(state, now); return; }   // third six in a row: turn is lost
  const legal = legalMoves(state, pi, dice);
  if (!legal.length) { state.last.note = 'nomove'; passTurn(state, now); return; }
  state.phase = 'move'; state.legal = legal;
  state.nextAt = now + AUTO_MS; state.deadline = now + HUMAN_MS;
}

function applyMove(state, tok, now) {
  const pi = state.turn; const dice = state.dice; const color = state.players[pi].color;
  const from = state.tokens[pi][tok];
  const to = from === -1 ? 0 : from + dice;
  state.tokens[pi][tok] = to;
  const captured = [];
  if (to <= 50) {
    const a = absIdx(color, to);
    if (!SAFE.has(a)) {
      state.players.forEach((q, qi) => {
        if (qi === pi) return;
        state.tokens[qi].forEach((r, t) => {
          if (r >= 0 && r <= 50 && absIdx(q.color, r) === a) { state.tokens[qi][t] = -1; captured.push({ p: qi, t, from: r }); }
        });
      });
    }
  }
  state.last = { id: ++state.seq, p: pi, dice, move: { tok, from, to }, captured, note: null };
  state.legal = [];
  if (state.tokens[pi].every((x) => x === HOME)) { state.status = 'finished'; state.winner = pi; state.phase = 'roll'; return; }
  if (dice === 6 || captured.length || to === HOME) {   // extra turn
    state.phase = 'roll'; state.deadline = now + HUMAN_MS + 1000; state.nextAt = now + NEXT_MS;
  } else passTurn(state, now);
}

// Bot: finish > capture > enter home column > safe cell > leave yard > run from danger > go with the front token
function dangerAt(state, pi, a) {   // can an opponent reach track cell `a` with one roll of 1-6?
  for (let q = 0; q < state.players.length; q++) {
    if (q === pi) continue;
    for (const r of state.tokens[q]) {
      if (r < 0 || r > 50) continue;
      const d = (a - absIdx(state.players[q].color, r) + 52) % 52;
      if (d >= 1 && d <= 6) return true;
    }
  }
  return false;
}
function botPick(state) {
  const pi = state.turn; const dice = state.dice; const color = state.players[pi].color;
  let best = state.legal[0]; let bestScore = -1e9;
  for (const t of state.legal) {
    const from = state.tokens[pi][t]; const to = from === -1 ? 0 : from + dice;
    let s = Math.random() * 3 + (to > 0 ? to / 8 : 0);
    if (to === HOME) s += 100;
    if (to <= 50) {
      const a = absIdx(color, to);
      if (!SAFE.has(a)) {
        const hit = state.players.some((q, qi) => qi !== pi && state.tokens[qi].some((r) => r >= 0 && r <= 50 && absIdx(q.color, r) === a));
        if (hit) s += 80;
        if (dangerAt(state, pi, a)) s -= 25;
      } else s += 28;
    } else s += 45;
    if (from === -1) s += 40;
    if (from >= 0 && from <= 50 && !SAFE.has(absIdx(color, from)) && dangerAt(state, pi, absIdx(color, from))) s += 30;
    if (s > bestScore) { bestScore = s; best = t; }
  }
  return best;
}

// Is something scheduled to happen by itself (bot move, single legal move, human timed out)?
function dueAt(state) {
  if (state.status !== 'playing') return null;
  const p = state.players[state.turn];
  if (state.phase === 'roll') return p.bot ? state.nextAt : state.deadline;
  if (state.legal.length === 1 || p.bot) return state.nextAt;
  return state.deadline;
}
const isDue = (state, now) => { const t = dueAt(state); return t !== null && now >= t; };

function step(state, now) {
  const p = state.players[state.turn];
  const timedOut = !p.bot && now >= state.deadline;
  if (timedOut) {
    p.afk = (p.afk || 0) + 1;
    if (p.afk >= 3) { p.bot = true; p.left = true; }          // 3 timeouts in a row: a bot takes the seat
    if (!state.players.some((x) => !x.bot)) { state.status = 'finished'; state.abandoned = true; return; }
  }
  if (state.phase === 'roll') { doRoll(state, now); return; }
  const tok = state.legal.length === 1 ? state.legal[0] : botPick(state);
  applyMove(state, tok, now);
}

// ---------- Database ----------
async function ensureSchema() {
  try {
    await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migration_v60.sql'), 'utf8'));
  } catch (err) {
    console.error('[ludo] migration_v60.sql did not run automatically (run it manually in the SQL editor):', err.message);
  }
}

const genCode = () => Array.from({ length: 5 }, () => CODE_CHARS[crypto.randomInt(0, CODE_CHARS.length)]).join('');
const winnerUserId = (st) => (st.winner !== null && st.players[st.winner] ? st.players[st.winner].userId || null : null);

async function save(client, row, st) {
  const members = st.players.filter((p) => p.userId && !p.left).map((p) => p.userId);
  const r = await client.query(
    `UPDATE ludo_games SET state = $2, status = $3, winner_id = $4, members = $5, host_id = $6, version = version + 1, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [row.id, JSON.stringify(st), st.status, winnerUserId(st), members, row.host_id]
  );
  return r.rows[0];
}

async function finishStats(client, st) {
  const humans = st.players.filter((p) => p.userId);
  if (st.winner === null || humans.length < 2) return;   // only real games between 2+ people count
  const win = winnerUserId(st);
  for (const p of humans) {
    await client.query(
      `INSERT INTO ludo_stats (user_id, played, won) VALUES ($1, 1, $2)
       ON CONFLICT (user_id) DO UPDATE SET played = ludo_stats.played + 1, won = ludo_stats.won + $2, updated_at = now()`,
      [p.userId, p.userId === win ? 1 : 0]
    );
  }
}

// Run fn(state, row, client) with the game row locked. fn returns { changed, deleted, ...extra }
async function withGame(code, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM ludo_games WHERE code = $1 FOR UPDATE', [code]);
    if (!r.rows[0]) { await client.query('ROLLBACK'); return { notFound: true }; }
    const row = r.rows[0]; const wasFinished = row.status === 'finished';
    const out = (await fn(row.state, row, client)) || {};
    let saved = row;
    if (out.deleted) await client.query('DELETE FROM ludo_games WHERE id = $1', [row.id]);
    else if (out.changed) {
      saved = await save(client, row, row.state);
      if (!wasFinished && row.state.status === 'finished') await finishStats(client, row.state);
    }
    await client.query('COMMIT');
    return { ...out, row: saved };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

let lastCleanup = 0;
async function cleanup() {
  if (Date.now() - lastCleanup < 30000) return;
  lastCleanup = Date.now();
  try {
    await pool.query("DELETE FROM ludo_games WHERE status = 'waiting' AND updated_at < now() - interval '3 hours'");
    await pool.query("UPDATE ludo_games SET status = 'finished', members = '{}', version = version + 1, state = jsonb_set(jsonb_set(state, '{status}', '\"finished\"'), '{abandoned}', 'true') WHERE status = 'playing' AND updated_at < now() - interval '20 minutes'");
    await pool.query("DELETE FROM ludo_games WHERE status = 'finished' AND updated_at < now() - interval '3 days'");
  } catch (err) { console.error('[ludo] cleanup:', err.message); }
}

async function activeCount(userId) {
  const r = await pool.query("SELECT COUNT(*)::int AS c FROM ludo_games WHERE $1 = ANY(members) AND status IN ('waiting','playing')", [userId]);
  return r.rows[0].c;
}

async function create(user, max, visibility, state) {
  await cleanup();
  if ((await activeCount(user.id)) >= MAX_ACTIVE) return { error: `You are already in ${MAX_ACTIVE} games. Finish or leave one first.` };
  max = [2, 3, 4].includes(max) ? max : 4;
  visibility = visibility === 'public' ? 'public' : 'private';
  const st = state || newState(user.id, user.username);
  for (let i = 0; i < 8; i++) {
    try {
      const r = await pool.query(
        `INSERT INTO ludo_games (code, host_id, max_players, visibility, state, members) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [genCode(), user.id, max, visibility, JSON.stringify(st), [user.id]]
      );
      return { row: r.rows[0] };
    } catch (err) { if (err.code !== '23505') throw err; }
  }
  return { error: 'Could not create a room, please try again.' };
}

// V61: which players have a profile photo (one small query per minute per user, then served from memory)
const avCache = new Map();   // userId -> { v: boolean, t: ms }
async function avatarFlags(state) {
  const out = {}; const need = []; const now = Date.now();
  for (const p of state.players || []) {
    if (!p.userId) continue;
    const c = avCache.get(p.userId);
    if (c && now - c.t < 60000) out[p.userId] = c.v; else need.push(p.userId);
  }
  if (need.length) {
    try {
      if (avCache.size > 2000) avCache.clear();
      const r = await pool.query('SELECT id, avatar_image_id IS NOT NULL AS av FROM users WHERE id = ANY($1)', [need]);
      const got = new Set();
      for (const x of r.rows) { out[x.id] = x.av; avCache.set(x.id, { v: x.av, t: now }); got.add(x.id); }
      for (const id of need) if (!got.has(id)) out[id] = false;
    } catch (err) { for (const id of need) out[id] = false; }   // never let a photo lookup break the game
  }
  return out;
}

const publicState = (row, userId, av) => {
  const s = row.state; const now = Date.now();
  const me = s.players.findIndex((p) => p.userId === userId && !p.left);
  const due = dueAt(s);
  return {
    v: row.version, code: row.code, status: s.status, host: row.host_id, max: row.max_players, visibility: row.visibility,
    players: s.players.map((p, i) => ({ i, userId: p.userId || null, name: p.name, color: p.color, bot: p.bot, left: p.left, av: !!(p.userId && av && av[p.userId]) })),
    tokens: s.tokens, turn: s.turn, phase: s.phase, legal: s.legal, last: s.last, winner: s.winner,
    abandoned: s.abandoned, rematch: s.rematch, deadline: s.deadline, me,
    chat: s.chat || [],
    now, nextIn: due === null ? null : Math.max(0, due - now),
  };
};
const view = async (row, userId) => publicState(row, userId, await avatarFlags(row.state));

async function poll(code, userId) {
  const r = await pool.query('SELECT * FROM ludo_games WHERE code = $1', [code]);
  let row = r.rows[0];
  if (!row) return null;
  if (row.status === 'playing' && isDue(row.state, Date.now())) {
    const o = await withGame(code, (st) => {
      if (st.status !== 'playing' || !isDue(st, Date.now())) return {};
      step(st, Date.now());
      return { changed: true };
    });
    if (o.row) row = o.row;
  }
  return view(row, userId);
}

// All player actions. Returns { error } or { state } (+ { rematch, left, deleted } for some actions)
async function act(code, user, body) {
  const type = String(body && body.type || '');
  const uid = user.id;
  if (type === 'join') {
    if ((await activeCount(uid)) >= MAX_ACTIVE) {
      const check = await pool.query('SELECT 1 FROM ludo_games WHERE code = $1 AND $2 = ANY(members)', [code, uid]);
      if (!check.rows[0]) return { error: `You are already in ${MAX_ACTIVE} games. Finish or leave one first.` };
    }
  }
  let error = null; let rematchCode = null; let leftOk = false;
  const out = await withGame(code, async (st, row) => {
    const now = Date.now();
    const meIdx = st.players.findIndex((p) => p.userId === uid && !p.left);
    const isHost = row.host_id === uid;
    const fail = (m) => { error = m; return {}; };

    if (type === 'join') {
      if (st.status !== 'waiting') return fail('This game has already started.');
      if (meIdx >= 0) return {};
      if (st.players.length >= row.max_players) return fail('This room is full.');
      st.players.push({ userId: uid, name: oneLine(user.username, 50), bot: false, left: false, afk: 0, color: null });
      return { changed: true };
    }
    if (type === 'leave') {
      if (meIdx < 0) { leftOk = true; return {}; }
      leftOk = true;
      if (st.status === 'waiting') {
        st.players.splice(meIdx, 1);
        const nextHost = st.players.find((p) => p.userId);
        if (!nextHost) return { deleted: true };
        row.host_id = nextHost.userId;
        return { changed: true };
      }
      if (st.status === 'playing') {
        st.players[meIdx].bot = true; st.players[meIdx].left = true;
        if (!st.players.some((p) => !p.bot)) { st.status = 'finished'; st.abandoned = true; }
        return { changed: true };
      }
      return {};
    }
    if (type === 'addbot' || type === 'fillbots' || type === 'rmbot' || type === 'start') {
      if (st.status !== 'waiting') return fail('The game has already started.');
      if (!isHost) return fail('Only the host can do this.');
      if (type === 'rmbot') {
        for (let i = st.players.length - 1; i >= 0; i--) if (st.players[i].bot) { st.players.splice(i, 1); return { changed: true }; }
        return {};
      }
      if (type === 'start') {
        if (st.players.length < 2) return fail('You need at least 2 players. Add a bot or invite a friend.');
        startGame(st, now);
        return { changed: true };
      }
      let added = 0;
      while (st.players.length < row.max_players && (type === 'fillbots' || added < 1)) {
        const used = new Set(st.players.map((p) => p.name));
        const name = BOT_NAMES.find((n) => !used.has(n)) || `Bot ${st.players.length + 1}`;
        st.players.push({ userId: null, name, bot: true, left: false, afk: 0, color: null });
        added++;
      }
      return added ? { changed: true } : fail('The room is full.');
    }
    if (type === 'roll') {
      if (st.status !== 'playing') return fail('The game is not running.');
      if (meIdx < 0 || st.turn !== meIdx) return fail('It is not your turn.');
      if (st.phase !== 'roll') return fail('Pick a token to move.');
      st.players[meIdx].afk = 0;
      doRoll(st, now);
      return { changed: true };
    }
    if (type === 'move') {
      if (st.status !== 'playing') return fail('The game is not running.');
      if (meIdx < 0 || st.turn !== meIdx) return fail('It is not your turn.');
      if (st.phase !== 'move') return fail('Roll the dice first.');
      const want = Number.isInteger(body.tok) ? body.tok : -2;
      if (want < 0 || want > 3) return fail('Invalid token.');
      const pos = st.tokens[meIdx][want];
      const tok = st.legal.find((t) => st.tokens[meIdx][t] === pos);   // equal-position tokens make the same move
      if (tok === undefined) return fail('That token cannot move.');
      st.players[meIdx].afk = 0;
      applyMove(st, tok, now);
      return { changed: true };
    }
    if (type === 'chat') {
      if (meIdx < 0) return fail('Only players in this room can chat.');
      const me = st.players[meIdx];
      let text = ''; let emoji = null;
      if (body.emoji !== undefined) {
        if (!CHAT_EMOJIS.includes(body.emoji)) return fail('Invalid emoji.');
        emoji = body.emoji;
      } else {
        text = oneLine(body.text, CHAT_MAX_LEN);
        if (!text) return fail('Type a message first.');
      }
      if (now - (me.chatAt || 0) < CHAT_GAP_MS) return fail('You are sending messages too fast.');
      me.chatAt = now;
      st.chat = st.chat || [];
      st.chatSeq = (st.chatSeq || 0) + 1;
      st.chat.push(emoji ? { id: st.chatSeq, u: uid, n: me.name, e: emoji, at: now } : { id: st.chatSeq, u: uid, n: me.name, t: text, at: now });
      if (st.chat.length > CHAT_KEEP) st.chat.splice(0, st.chat.length - CHAT_KEEP);
      return { changed: true };
    }
    if (type === 'rematch') {
      if (st.status !== 'finished') return fail('The game is not finished.');
      if (!st.players.some((p) => p.userId === uid)) return fail('You were not in this game.');
      if (st.rematch) { rematchCode = st.rematch; return {}; }
      return { makeRematch: true };
    }
    return fail('Unknown action.');
  });
  if (out.notFound) return { error: 'Game not found.' };
  if (error) return { error };
  if (out.makeRematch) {
    // New room for the same people: the one who pressed becomes host, the others follow the link.
    const made = await create(user, out.row.max_players, out.row.visibility);
    if (made.error) return { error: made.error };
    let winnerCode = made.row.code;
    await withGame(code, (st) => {
      if (st.rematch) { winnerCode = st.rematch; return {}; }   // someone else pressed at the same moment: use their room
      st.rematch = made.row.code; return { changed: true };
    });
    if (winnerCode !== made.row.code) await withGame(made.row.code, () => ({ deleted: true }));
    return { rematch: winnerCode };
  }
  if (rematchCode) return { rematch: rematchCode };
  if (out.deleted || leftOk) return { left: true, state: out.deleted ? null : await view(out.row, uid) };
  return { state: await view(out.row, uid) };
}

async function lobby(userId) {
  await cleanup();
  const open = await pool.query(
    `SELECT g.code, g.max_players, u.username AS host, jsonb_array_length(g.state->'players') AS n
     FROM ludo_games g JOIN users u ON u.id = g.host_id
     WHERE g.status = 'waiting' AND g.visibility = 'public' AND g.updated_at > now() - interval '30 minutes'
     ORDER BY g.updated_at DESC LIMIT 12`);
  let mine = [];
  if (userId) {
    const q = await pool.query(
      `SELECT code, status, max_players, jsonb_array_length(state->'players') AS n, updated_at FROM ludo_games
       WHERE $1 = ANY(members) AND status IN ('waiting','playing') ORDER BY updated_at DESC LIMIT 6`, [userId]);
    mine = q.rows;
  }
  const top = await pool.query(
    `SELECT u.username, s.played, s.won FROM ludo_stats s JOIN users u ON u.id = s.user_id
     WHERE s.played >= 1 ORDER BY s.won DESC, s.played ASC, s.updated_at DESC LIMIT 10`);
  return { open: open.rows.filter((g) => g.n < g.max_players), mine, top: top.rows };
}

async function find(code) {
  const r = await pool.query('SELECT * FROM ludo_games WHERE code = $1', [code]);
  return r.rows[0] || null;
}

module.exports = {
  BOARD, COLOR_NAMES, MAX_ACTIVE, CHAT_EMOJIS, CHAT_MAX_LEN, ensureSchema, create, poll, act, lobby, find, publicState, view,
  // exported for tests
  _rules: { newState, startGame, legalMoves, doRoll, applyMove, botPick, step, isDue, dueAt, absIdx, SAFE, TRACK_RC, HOME_RC, HUMAN_MS },
};
