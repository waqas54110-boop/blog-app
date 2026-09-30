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
        `SELECT p.id, p.slug, p.title, COUNT(v.id)::int AS visits,
                COUNT(*) FILTER (WHERE v.source = 'whatsapp')::int AS whatsapp,
                COUNT(*) FILTER (WHERE v.source = 'facebook')::int AS facebook
         FROM post_visits v JOIN posts p ON p.id = v.post_id
         WHERE v.created_at > ${since}
         GROUP BY p.id, p.slug, p.title ORDER BY visits DESC LIMIT 10`,
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

    // Vote contests ke numbers (alag try: migration_v9 na chali ho to baaqi analytics phir bhi chale)
    let pollStats = null;
    try {
      const [perPoll, bySrcViews, bySrcVotes] = await Promise.all([
        pool.query(
          `WITH allv AS (
             SELECT poll_id, source, created_at FROM poll_votes
             UNION ALL
             SELECT poll_id, source, created_at FROM poll_match_votes
           ),
           ev AS (
             SELECT poll_id,
                    COUNT(*) FILTER (WHERE kind = 'view')::int AS opens,
                    COUNT(DISTINCT visitor) FILTER (WHERE kind = 'view')::int AS people,
                    COUNT(*) FILTER (WHERE kind = 'view' AND via = 'post')::int AS in_post,
                    COUNT(*) FILTER (WHERE kind = 'view' AND source = 'whatsapp')::int AS wa_opens,
                    COUNT(*) FILTER (WHERE kind = 'share')::int AS shares
             FROM poll_events WHERE created_at > ${since} GROUP BY poll_id
           ),
           vt AS (
             SELECT poll_id, COUNT(*)::int AS votes,
                    COUNT(*) FILTER (WHERE source = 'whatsapp')::int AS wa_votes,
                    COUNT(*) FILTER (WHERE source = 'facebook')::int AS fb_votes
             FROM allv WHERE created_at > ${since} GROUP BY poll_id
           )
           SELECT p.id, p.title, p.kind,
                  COALESCE(ev.opens, 0) AS opens, COALESCE(ev.people, 0) AS people, COALESCE(ev.in_post, 0) AS in_post,
                  COALESCE(ev.wa_opens, 0) AS wa_opens, COALESCE(ev.shares, 0) AS shares,
                  COALESCE(vt.votes, 0) AS votes, COALESCE(vt.wa_votes, 0) AS wa_votes, COALESCE(vt.fb_votes, 0) AS fb_votes
           FROM polls p LEFT JOIN ev ON ev.poll_id = p.id LEFT JOIN vt ON vt.poll_id = p.id
           WHERE COALESCE(ev.opens, 0) + COALESCE(vt.votes, 0) > 0
           ORDER BY COALESCE(ev.opens, 0) + COALESCE(vt.votes, 0) DESC
           LIMIT 20`,
          [days]
        ),
        pool.query(
          `SELECT COALESCE(source, 'direct') AS source, COUNT(*)::int AS n
           FROM poll_events WHERE kind = 'view' AND created_at > ${since} GROUP BY 1`,
          [days]
        ),
        pool.query(
          `SELECT COALESCE(source, 'direct') AS source, COUNT(*)::int AS n FROM (
             SELECT source, created_at FROM poll_votes UNION ALL SELECT source, created_at FROM poll_match_votes
           ) v WHERE created_at > ${since} GROUP BY 1`,
          [days]
        ),
      ]);
      const sum = (k) => perPoll.rows.reduce((a, r) => a + r[k], 0);
      const srcMap = {};
      bySrcViews.rows.forEach((r) => { srcMap[r.source] = { source: r.source, opens: r.n, votes: 0 }; });
      bySrcVotes.rows.forEach((r) => {
        srcMap[r.source] = srcMap[r.source] || { source: r.source, opens: 0, votes: 0 };
        srcMap[r.source].votes = r.n;
      });
      pollStats = {
        polls: perPoll.rows,
        totals: {
          opens: sum('opens'), people: sum('people'), votes: sum('votes'), shares: sum('shares'),
          wa_opens: sum('wa_opens'), wa_votes: sum('wa_votes'),
        },
        sources: Object.values(srcMap).sort((a, b) => (b.opens + b.votes) - (a.opens + a.votes)),
      };
    } catch (err) {
      console.error('[analytics] polls:', err.message);
    }

    res.render('analytics', {
      title: 'Analytics',
      days,
      totals: totals.rows[0],
      daily: daily.rows,
      sources: sources.rows,
      topPosts: posts.rows,
      referrers: referrers.rows,
      mediums: mediums.rows,
      pollStats,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
