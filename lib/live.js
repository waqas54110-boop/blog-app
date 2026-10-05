// Live broadcasting ka server-side logic. Video host ke browser se dekhne walon ke browser tak seedha (WebRTC) jati hai;
// server sirf "signaling" (offer / answer / ICE) aur live ki halat sambhalta hai (calls ki tarah, database ke zariye).
const pool = require('../db');

const HOST_STALE = 25;    // host itni der khamosh ho to live khatam
const VIEWER_STALE = 15;  // viewer itni der khamosh ho to wo chala gaya

// Khamosh ho gaye live band karo, purane signals saaf
async function janitor() {
  await pool.query(
    `UPDATE live_streams SET status = 'ended', ended_at = LEAST(now(), host_seen)
     WHERE status = 'live' AND host_seen < now() - interval '${HOST_STALE} seconds'`
  );
  await pool.query(`DELETE FROM live_signals WHERE created_at < now() - interval '1 day'`);
}

// migration_v28.sql (mode, video_id columns) chali hai? Nahi chali to live purane p2p tareeqe se chalta rahe.
let v28 = false;
let v28At = 0;
async function hasV28() {
  if (v28) return true;
  if (Date.now() - v28At < 30000) return false;
  v28At = Date.now();
  const r = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'live_streams' AND column_name = 'mode' LIMIT 1`);
  v28 = r.rowCount > 0;
  return v28;
}

// Live, post, host ka naam, aur host kitni der se khamosh hai
async function load(id) {
  const extra = (await hasV28()) ? 's.mode, s.video_id' : `'p2p'::text AS mode, NULL::int AS video_id`;
  const r = await pool.query(
    `SELECT s.id, s.user_id, s.post_id, s.status, ${extra}, f.group_id, u.username AS host_name,
            EXTRACT(EPOCH FROM (now() - s.host_seen))::float8 AS host_age
     FROM live_streams s JOIN feed_posts f ON f.id = s.post_id JOIN users u ON u.id = s.user_id
     WHERE s.id = $1`,
    [id]
  );
  return r.rows[0] || null;
}

// Live ko khatam karo (sirf ek hi dafa kamyab) aur saare dekhne walon ko nikal do
async function end(id) {
  const r = await pool.query(
    `UPDATE live_streams SET status = 'ended', ended_at = now() WHERE id = $1 AND status = 'live' RETURNING id`,
    [id]
  );
  if (!r.rowCount) return false;
  await pool.query('UPDATE live_viewers SET left_at = now() WHERE stream_id = $1 AND left_at IS NULL', [id]);
  await pool.query('DELETE FROM live_signals WHERE stream_id = $1', [id]);
  return true;
}

// Abhi zinda dekhne walon ke session ids
async function activeSessions(streamId, limit = 50) {
  const r = await pool.query(
    `SELECT id FROM live_viewers
     WHERE stream_id = $1 AND left_at IS NULL AND seen > now() - interval '${VIEWER_STALE} seconds'
     ORDER BY id LIMIT $2`,
    [streamId, limit]
  );
  return r.rows.map((x) => Number(x.id));
}

async function viewerCount(streamId) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM live_viewers WHERE stream_id = $1 AND left_at IS NULL AND seen > now() - interval '${VIEWER_STALE} seconds'`,
    [streamId]
  );
  return r.rows[0].n;
}

// Feed ke cards ke liye: in posts ke live (agar hain) ki halat. post.live = {...} laga deta hai.
// migration_v27 na chali ho to feed phir bhi chalta hai.
let warned = false;
async function attachToPosts(posts) {
  posts.forEach((p) => { p.live = null; });
  if (!posts.length) return posts;
  const sql = (withVideo) => `SELECT s.id, s.post_id, s.peak_viewers, ${withVideo ? 's.video_id' : 'NULL::int AS video_id'},
              CASE WHEN s.status = 'live' AND s.host_seen < now() - interval '${HOST_STALE} seconds' THEN 'ended' ELSE s.status END AS status,
              GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(s.ended_at, LEAST(now(), s.host_seen)) - s.started_at)))::int AS secs,
              (SELECT COUNT(*)::int FROM live_viewers v
                 WHERE v.stream_id = s.id AND v.left_at IS NULL AND v.seen > now() - interval '${VIEWER_STALE} seconds') AS viewers
       FROM live_streams s WHERE s.post_id = ANY($1::int[])`;
  const ids = [posts.map((p) => p.id)];
  try {
    let r;
    try { r = await pool.query(sql(true), ids); }
    catch (e) {
      if (e.code !== '42703') throw e;   // video_id column nahi: migration_v28.sql abhi chali nahi
      r = await pool.query(sql(false), ids);
    }
    const map = new Map(r.rows.map((x) => [x.post_id, x]));
    posts.forEach((p) => { p.live = map.get(p.id) || null; });
  } catch (err) {
    if (!warned) { warned = true; console.error('[live] feed par live ki halat nahi mili (migration_v27.sql chali?):', err.message); }
  }
  return posts;
}

module.exports = { hasV28, HOST_STALE, VIEWER_STALE, janitor, load, end, activeSessions, viewerCount, attachToPosts };
