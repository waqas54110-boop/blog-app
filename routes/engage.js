const express = require('express');
const pool = require('../db');
const config = require('../config');

const router = express.Router();
const TZ = config.timezone;

const requireLogin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    return res.status(403).render('404', {
      code: 403,
      title: 'Not allowed',
      message: 'Only the blog owner can do this.',
    });
  }
  next();
};

// ---------- NOTIFICATIONS ----------
router.get('/notifications', requireLogin, async (req, res) => {
  try {
    const uid = req.session.user.id;
    const result = await pool.query(
      `SELECT id, message, link, is_read, created_at
       FROM notifications WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [uid]
    );
    // Page khulte hi sab "read" ho jati hain (is render mein nayi wali highlight rehti hain)
    await pool.query('UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false', [uid]);
    res.locals.unreadCount = 0;
    res.render('notifications', { title: 'Notifications', notifications: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// ---------- NEWSLETTER UNSUBSCRIBE ----------
router.get('/unsubscribe/:token', async (req, res) => {
  const token = String(req.params.token || '');
  let done = false;
  if (/^[a-f0-9]{16,64}$/i.test(token)) {
    try {
      const r = await pool.query('DELETE FROM subscribers WHERE unsubscribe_token = $1', [token]);
      done = r.rowCount > 0;
    } catch (err) {
      console.error(err);
    }
  }
  res.render('unsubscribed', { title: 'Unsubscribe', done });
});

// ---------- ANALYTICS (admin) ----------
router.get('/analytics', requireAdmin, async (req, res) => {
  const days = [7, 30, 90].includes(parseInt(req.query.days, 10)) ? parseInt(req.query.days, 10) : 30;

  try {
    const since = `now() - ($1::int * interval '1 day')`;
    const [totals, daily, sources, posts, referrers, mediums] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS visits,
                COUNT(*) FILTER (WHERE source = 'whatsapp')::int AS whatsapp,
                COUNT(*) FILTER (WHERE source = 'facebook')::int AS facebook,
                COUNT(*) FILTER (WHERE source IN ('google','bing'))::int AS search,
                COUNT(*) FILTER (WHERE source = 'newsletter')::int AS newsletter
         FROM post_visits WHERE created_at > ${since}`,
        [days]
      ),
      pool.query(
        `SELECT to_char(d, 'DD Mon') AS label, COUNT(v.id)::int AS visits
         FROM generate_series(
                date_trunc('day', now() AT TIME ZONE $2::text) - (($1::int - 1) * interval '1 day'),
                date_trunc('day', now() AT TIME ZONE $2::text),
                interval '1 day') AS d
         LEFT JOIN post_visits v
           ON date_trunc('day', v.created_at AT TIME ZONE $2::text) = d
         GROUP BY d ORDER BY d`,
        [days, TZ]
      ),
      pool.query(
        `SELECT source, COUNT(*)::int AS visits
         FROM post_visits WHERE created_at > ${since}
         GROUP BY source ORDER BY visits DESC`,
        [days]
      ),
      pool.query(
        `SELECT p.id, p.title, COUNT(v.id)::int AS visits,
                COUNT(*) FILTER (WHERE v.source = 'whatsapp')::int AS whatsapp,
                COUNT(*) FILTER (WHERE v.source = 'facebook')::int AS facebook
         FROM post_visits v JOIN posts p ON p.id = v.post_id
         WHERE v.created_at > ${since}
         GROUP BY p.id, p.title ORDER BY visits DESC LIMIT 10`,
        [days]
      ),
      pool.query(
        `SELECT referrer, COUNT(*)::int AS visits
         FROM post_visits
         WHERE created_at > ${since} AND referrer IS NOT NULL AND source <> 'internal'
         GROUP BY referrer ORDER BY visits DESC LIMIT 10`,
        [days]
      ),
      pool.query(
        `SELECT source, COALESCE(medium, '-') AS medium, COUNT(*)::int AS visits
         FROM post_visits
         WHERE created_at > ${since} AND source IN ('whatsapp', 'facebook', 'newsletter')
         GROUP BY source, medium ORDER BY source, visits DESC`,
        [days]
      ),
    ]);

    res.render('analytics', {
      title: 'Analytics',
      days,
      totals: totals.rows[0],
      daily: daily.rows,
      sources: sources.rows,
      topPosts: posts.rows,
      referrers: referrers.rows,
      mediums: mediums.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
