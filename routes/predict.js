// Prediction League: admin match banata hai, readers winner chunte hain, result ke baad points milte hain.
const express = require('express');
const pool = require('../db');
const { notifyUser } = require('../lib/notify');

const router = express.Router();
const POINTS = 10;
const PICKS = ['a', 'b', 'draw'];

const requireLogin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  next();
};
const requireAdmin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    return res.status(403).render('404', { code: 403, title: 'Not allowed', message: 'Only the blog owner can do this.' });
  }
  next();
};

const oneLine = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// ---------- PUBLIC: page ----------
router.get('/predictions', async (req, res, next) => {
  try {
    const uid = req.session.user ? req.session.user.id : null;

    const open = await pool.query(
      `SELECT m.*, p.pick AS my_pick,
              (SELECT COUNT(*)::int FROM predictions x WHERE x.match_id = m.id) AS total,
              (SELECT COUNT(*)::int FROM predictions x WHERE x.match_id = m.id AND x.pick = 'a') AS votes_a,
              (SELECT COUNT(*)::int FROM predictions x WHERE x.match_id = m.id AND x.pick = 'b') AS votes_b
       FROM pred_matches m
       LEFT JOIN predictions p ON p.match_id = m.id AND p.user_id = $1
       WHERE m.winner IS NULL
       ORDER BY m.starts_at ASC`,
      [uid]
    );

    const done = await pool.query(
      `SELECT m.*, p.pick AS my_pick, p.points AS my_points
       FROM pred_matches m
       LEFT JOIN predictions p ON p.match_id = m.id AND p.user_id = $1
       WHERE m.winner IS NOT NULL
       ORDER BY m.settled_at DESC
       LIMIT 10`,
      [uid]
    );

    const leaders = await pool.query(
      `SELECT u.username, SUM(p.points)::int AS pts,
              COUNT(*) FILTER (WHERE p.points > 0)::int AS correct,
              COUNT(*)::int AS played
       FROM predictions p
       JOIN users u ON u.id = p.user_id
       JOIN pred_matches m ON m.id = p.match_id AND m.winner IS NOT NULL
       GROUP BY u.id, u.username
       ORDER BY pts DESC, correct DESC, u.username ASC
       LIMIT 20`
    );

    const now = Date.now();
    res.render('predictions', {
      title: 'Prediction League',
      metaDescription: 'Predict the winner of upcoming cricket matches, earn points and climb the leaderboard.',
      openMatches: open.rows.map((m) => ({ ...m, locked: new Date(m.starts_at).getTime() <= now })),
      doneMatches: done.rows,
      leaders: leaders.rows,
      points: POINTS,
      error: req.query.error || null,
      saved: req.query.saved === '1',
    });
  } catch (err) {
    next(err);
  }
});

// ---------- USER: prediction lagana / badalna (match shuru hone se pehle tak) ----------
router.post('/predictions/:id/pick', requireLogin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const pick = String(req.body.pick || '');
    if (!Number.isInteger(id) || !PICKS.includes(pick)) return res.redirect('/predictions?error=Invalid+choice');

    const m = await pool.query('SELECT winner, starts_at FROM pred_matches WHERE id = $1', [id]);
    const match = m.rows[0];
    if (!match) return res.redirect('/predictions?error=Match+not+found');
    if (match.winner !== null || new Date(match.starts_at).getTime() <= Date.now()) {
      return res.redirect('/predictions?error=Predictions+for+this+match+are+closed');
    }

    await pool.query(
      `INSERT INTO predictions (match_id, user_id, pick) VALUES ($1, $2, $3)
       ON CONFLICT (match_id, user_id) DO UPDATE SET pick = EXCLUDED.pick`,
      [id, req.session.user.id, pick]
    );
    res.redirect('/predictions?saved=1');
  } catch (err) {
    next(err);
  }
});

// ---------- ADMIN: match banana ----------
router.post('/predictions/matches', requireAdmin, async (req, res, next) => {
  try {
    const teamA = oneLine(req.body.team_a, 60);
    const teamB = oneLine(req.body.team_b, 60);
    const title = oneLine(req.body.title, 120) || null;
    const startsAt = new Date(req.body.starts_at || '');
    if (!teamA || !teamB || teamA.toLowerCase() === teamB.toLowerCase()) {
      return res.redirect('/predictions?error=Enter+two+different+team+names');
    }
    if (isNaN(startsAt.getTime())) return res.redirect('/predictions?error=Enter+a+valid+start+time');

    await pool.query(
      'INSERT INTO pred_matches (team_a, team_b, title, starts_at) VALUES ($1, $2, $3, $4)',
      [teamA, teamB, title, startsAt.toISOString()]
    );
    res.redirect('/predictions?saved=1');
  } catch (err) {
    next(err);
  }
});

// ---------- ADMIN: result daalna (points bantna + notification) ----------
router.post('/predictions/matches/:id/settle', requireAdmin, async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  const winner = String(req.body.winner || '');
  if (!Number.isInteger(id) || !PICKS.includes(winner)) return res.redirect('/predictions?error=Invalid+result');

  const client = await pool.connect();
  let match, winners = [];
  try {
    await client.query('BEGIN');
    // Sirf pehli baar settle ho (double points se bachao)
    const u = await client.query(
      `UPDATE pred_matches SET winner = $2, settled_at = now()
       WHERE id = $1 AND winner IS NULL RETURNING team_a, team_b`,
      [id, winner]
    );
    match = u.rows[0];
    if (!match) {
      await client.query('ROLLBACK');
      return res.redirect('/predictions?error=Match+already+settled+or+not+found');
    }
    const w = await client.query(
      'UPDATE predictions SET points = $2 WHERE match_id = $1 AND pick = $3 RETURNING user_id',
      [id, POINTS, winner]
    );
    winners = w.rows.map((r) => r.user_id);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return next(err);
  } finally {
    client.release();
  }

  // Notifications (fail hon to bhi result save rehta hai)
  const label = winner === 'draw' ? 'Draw' : (winner === 'a' ? match.team_a : match.team_b) + ' won';
  for (const uid of winners) {
    await notifyUser(uid, `🎯 Correct! ${match.team_a} vs ${match.team_b}: ${label}. You earned ${POINTS} points.`, '/predictions');
  }
  res.redirect('/predictions?saved=1');
});

// ---------- ADMIN: match hatana ----------
router.post('/predictions/matches/:id/delete', requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isInteger(id)) await pool.query('DELETE FROM pred_matches WHERE id = $1', [id]);
    res.redirect('/predictions');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
