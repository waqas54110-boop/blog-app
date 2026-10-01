// Sponsored contest + giveaway + sponsor report + homepage contest.
const crypto = require('crypto');
const pool = require('../db');
const config = require('../config');
const P = require('./polls');
const { isBot } = require('./analytics');

const IMG_RE = /^\/img\/\d{1,9}$/;
const oneLine = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// ---------- sponsor form ----------
// { error } ya { value }. Link http(s) hi ho sakta hai (javascript: wagaira nahi), logo hamari apni /img/ID hi.
async function parseSponsor(b) {
  const name = oneLine(b.sponsor_name, 80);
  const prize = oneLine(b.prize, 160);
  const logo = String(b.sponsor_logo || '').trim();
  const pool_ = b.giveaway_pool === 'winner' ? 'winner' : 'all';
  const featured = b.featured === '1' || b.featured === 'on';
  let url = String(b.sponsor_url || '').trim();

  if (url) {
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad');
      url = u.toString();
      if (url.length > 500) throw new Error('long');
    } catch (e) {
      return { error: 'Sponsor link is not a valid web address.' };
    }
    if (!name) return { error: 'Please add the sponsor name too.' };
  }
  if (logo) {
    if (!IMG_RE.test(logo)) return { error: 'Sponsor logo is not valid. Upload it again.' };
    const ex = await pool.query('SELECT 1 FROM images WHERE id = $1', [parseInt(logo.slice(5), 10)]);
    if (!ex.rows[0]) return { error: 'Sponsor logo was not found. Upload it again.' };
  }
  return { value: { name: name || null, url: url || null, logo: logo || null, prize: prize || null, pool: pool_, featured } };
}

async function saveSponsor(pollId, v) {
  await pool.query(
    `UPDATE polls SET sponsor_name = $2, sponsor_url = $3, sponsor_logo = $4, prize = $5, giveaway_pool = $6, featured = $7
     WHERE id = $1`,
    [pollId, v.name, v.url, v.logo, v.prize, v.pool, v.featured]
  );
}

// Contest page / homepage / Telegram ke liye sponsor + giveaway ki maloomat
async function extras(id) {
  const r = await pool.query(
    `SELECT p.sponsor_name, p.sponsor_url, p.sponsor_logo, p.prize, p.featured, p.giveaway_pool,
            p.giveaway_user_id, p.giveaway_at, p.giveaway_count, p.giveaway_redraws,
            (SELECT u.username FROM users u WHERE u.id = p.giveaway_user_id) AS giveaway_username
     FROM polls p WHERE p.id = $1`, [id]);
  return r.rows[0] || {};
}

// ---------- giveaway ----------
// Eligible: voters jin ki email verified hai (V10), admin nahi. mode 'winner' = jeetne wale option ko vote dene walay.
function eligibleQuery(pollId, st, mode, excludeId) {
  const ko = st.kind === 'knockout';
  const table = ko ? 'poll_match_votes' : 'poll_votes';
  const params = [pollId];
  let extra = '';
  if (mode === 'winner') {
    const w = ko ? (st.champion && st.champion.id) : st.matches[0].winnerId;
    if (!w) return null;
    params.push(w);
    extra += ` AND v.option_id = $${params.length}`;
  }
  if (excludeId) {
    params.push(excludeId);
    extra += ` AND u.id <> $${params.length}`;
  }
  return {
    sql: `SELECT DISTINCT u.id FROM ${table} v JOIN users u ON u.id = v.user_id
          WHERE v.poll_id = $1 AND u.role <> 'admin' AND u.email_verified = true${extra}`,
    params,
  };
}

async function countEligible(pollId, st, mode) {
  const q = eligibleQuery(pollId, st, mode, null);
  if (!q) return null;
  const r = await pool.query(`SELECT COUNT(*)::int AS n FROM (${q.sql}) t`, q.params);
  return r.rows[0].n;
}

// Admin ko dikhane ke liye: kitne log eligible hain, winner ki email
async function adminInfo(id, st, ex) {
  const info = { eligibleAll: 0, eligibleWinner: null, winnerEmail: null };
  try {
    info.eligibleAll = await countEligible(id, st, 'all');
    info.eligibleWinner = await countEligible(id, st, 'winner');
    if (ex.giveaway_user_id) {
      const r = await pool.query('SELECT email FROM users WHERE id = $1', [ex.giveaway_user_id]);
      info.winnerEmail = r.rows[0] ? r.rows[0].email : null;
    }
  } catch (err) {
    console.error('[giveaway] info:', err.message);
  }
  return info;
}

// Ek random winner. crypto.randomInt (asli random). redraw = true: pehle winner ko nikal kar dobara.
async function drawGiveaway(pollId, redraw) {
  const st = await P.loadState(pollId, null);
  if (!st) return { error: 'Contest not found.' };
  if (st.open) return { error: 'Close the contest (or wait until it ends) before drawing a winner.' };
  const ex = await extras(pollId);
  if (!ex.prize) return { error: 'Add a prize first (Sponsor & prize box).' };
  if (ex.giveaway_user_id && !redraw) return { error: 'A winner was already drawn.' };

  const q = eligibleQuery(pollId, st, ex.giveaway_pool, redraw ? ex.giveaway_user_id : null);
  if (!q) return { error: 'There is no clear winner yet (tie or no votes), so "winner side" cannot be used.' };
  const ids = (await pool.query(q.sql, q.params)).rows.map((r) => r.id);
  if (!ids.length) return { error: 'No eligible voters (verified accounts that voted) to draw from.' };

  const winnerId = ids[crypto.randomInt(ids.length)];
  const r = await pool.query(
    `UPDATE polls SET giveaway_user_id = $2, giveaway_at = now(), giveaway_count = $3,
            giveaway_redraws = CASE WHEN giveaway_user_id IS NULL THEN 0 ELSE giveaway_redraws + 1 END
     WHERE id = $1 AND (giveaway_user_id IS NULL OR $4::boolean) RETURNING giveaway_user_id`,
    [pollId, winnerId, ids.length, !!redraw]
  );
  if (!r.rows[0]) return { error: 'A winner was already drawn.' };
  const u = await pool.query('SELECT username FROM users WHERE id = $1', [winnerId]);
  return { ok: true, userId: winnerId, username: u.rows[0] ? u.rows[0].username : '', count: ids.length, title: st.title };
}

// ---------- sponsor link click ----------
const cookie = P.cookie;
async function trackClick(req, pollId) {
  try {
    if (isBot(req)) return;
    if (req.session && req.session.user && req.session.user.role === 'admin') return;
    const vid = cookie(req, 'pv');
    const visitor = /^[a-f0-9]{16}$/.test(vid) ? vid : null;
    if (visitor) { // ek insaan ek ghante mein ek hi click ginta hai
      const dup = await pool.query(
        `SELECT 1 FROM poll_events WHERE poll_id = $1 AND kind = 'click' AND visitor = $2 AND created_at > now() - interval '1 hour' LIMIT 1`,
        [pollId, visitor]);
      if (dup.rows[0]) return;
    }
    await pool.query(
      "INSERT INTO poll_events (poll_id, kind, source, via, visitor) VALUES ($1, 'click', 'sponsor', 'page', $2)",
      [pollId, visitor]);
  } catch (err) {
    console.error('[sponsor] click:', err.message);
  }
}

// ---------- homepage live contest ----------
let homeCache = { t: 0, id: null };
async function pickHomeId() {
  if (Date.now() - homeCache.t < 60 * 1000) return homeCache.id;
  const r = await pool.query(
    `SELECT p.id FROM polls p
     WHERE p.is_closed = false
       AND ((p.kind = 'vote' AND (p.ends_at IS NULL OR p.ends_at > now())) OR (p.kind = 'knockout' AND p.winner_option_id IS NULL))
     ORDER BY p.featured DESC,
              ((SELECT COUNT(*) FROM poll_votes v WHERE v.poll_id = p.id AND v.created_at > now() - interval '3 days')
             + (SELECT COUNT(*) FROM poll_match_votes v WHERE v.poll_id = p.id AND v.created_at > now() - interval '3 days')) DESC,
              p.created_at DESC
     LIMIT 1`);
  homeCache = { t: Date.now(), id: r.rows[0] ? r.rows[0].id : null };
  return homeCache.id;
}

// Homepage ke liye: sab se garam (ya pin kiya hua) abhi chalta contest. Koi masla ho to homepage chalta rahe (null).
async function homeContest(req, res, base) {
  try {
    const id = await pickHomeId();
    if (!id) return null;
    const notice = await P.applyPending(req, id);
    const st = await P.loadState(id, req.session.user ? req.session.user.id : null, base);
    if (!st || !st.open) { homeCache.t = 0; return null; }
    if (!res.locals.isAdmin) P.trackView(req, res, id, 'home');
    return { st, notice, extras: await extras(id) };
  } catch (err) {
    console.error('[home contest]', err.message);
    return null;
  }
}

// ---------- sponsor report ----------
async function report(pollId) {
  const tz = config.timezone;
  const allVotes = `(SELECT user_id, source, created_at FROM poll_votes WHERE poll_id = $1
                     UNION ALL SELECT user_id, source, created_at FROM poll_match_votes WHERE poll_id = $1) v`;
  const [ev, viewSrc, shareSrc, vt, voteSrc, byDay, cm] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE kind = 'view')::int AS views,
              COUNT(DISTINCT visitor) FILTER (WHERE kind = 'view')::int AS people,
              COUNT(*) FILTER (WHERE kind = 'view' AND via = 'page')::int AS page_views,
              COUNT(*) FILTER (WHERE kind = 'view' AND via = 'post')::int AS post_views,
              COUNT(*) FILTER (WHERE kind = 'view' AND via = 'home')::int AS home_views,
              COUNT(*) FILTER (WHERE kind = 'share')::int AS shares,
              COUNT(*) FILTER (WHERE kind = 'click')::int AS clicks
       FROM poll_events WHERE poll_id = $1`, [pollId]),
    pool.query("SELECT COALESCE(source, 'direct') AS source, COUNT(*)::int AS n FROM poll_events WHERE poll_id = $1 AND kind = 'view' GROUP BY 1 ORDER BY n DESC", [pollId]),
    pool.query("SELECT COALESCE(source, 'other') AS source, COUNT(*)::int AS n FROM poll_events WHERE poll_id = $1 AND kind = 'share' GROUP BY 1 ORDER BY n DESC", [pollId]),
    pool.query(`SELECT COUNT(*)::int AS votes, COUNT(DISTINCT user_id)::int AS voters FROM ${allVotes}`, [pollId]),
    pool.query(`SELECT COALESCE(source, 'direct') AS source, COUNT(*)::int AS n FROM ${allVotes} GROUP BY 1 ORDER BY n DESC`, [pollId]),
    pool.query(`SELECT to_char(created_at AT TIME ZONE $2::text, 'YYYY-MM-DD') AS day, COUNT(*)::int AS n FROM ${allVotes} GROUP BY 1 ORDER BY 1`, [pollId, tz]),
    pool.query('SELECT COUNT(*)::int AS n FROM poll_comments WHERE poll_id = $1', [pollId]),
  ]);
  return {
    ...ev.rows[0], ...vt.rows[0], comments: cm.rows[0].n,
    viewSources: viewSrc.rows, shareSources: shareSrc.rows, voteSources: voteSrc.rows, byDay: byDay.rows,
  };
}

module.exports = {
  parseSponsor, saveSponsor, extras, adminInfo, drawGiveaway, eligibleQuery, countEligible,
  trackClick, homeContest, report,
};
