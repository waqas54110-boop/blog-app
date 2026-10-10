const express = require('express');
const pool = require('../db');
const { AGE_GROUPS, countryName, flag } = require('../lib/demographics');
const config = require('../config');
const ipinfo = require('../lib/ipinfo');

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
  if (req.query.tab === 'bots') return botsTab(req, res, days);

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

    // ===== Naye features: pichle period se muqabla, best posting time (heatmap), live pulse, smart insights =====
    let extra = null;
    try {
      const [prevTot, prevDaily, heat, live, hot] = await Promise.all([
        pool.query(
          `SELECT COUNT(*)::int AS visits,
                  COUNT(*) FILTER (WHERE source = 'whatsapp')::int AS whatsapp,
                  COUNT(*) FILTER (WHERE source = 'facebook')::int AS facebook,
                  COUNT(*) FILTER (WHERE source IN ('google','bing'))::int AS search,
                  COUNT(*) FILTER (WHERE source = 'newsletter')::int AS newsletter
           FROM post_visits
           WHERE created_at > now() - (($1::int * 2) * interval '1 day') AND created_at <= now() - ($1::int * interval '1 day')`,
          [days]
        ),
        pool.query(
          `SELECT COUNT(v.id)::int AS visits
           FROM generate_series(
                  date_trunc('day', now() AT TIME ZONE $2::text) - (($1::int * 2 - 1) * interval '1 day'),
                  date_trunc('day', now() AT TIME ZONE $2::text) - ($1::int * interval '1 day'),
                  interval '1 day') AS d
           LEFT JOIN post_visits v
             ON date_trunc('day', v.created_at AT TIME ZONE $2::text) = d
           GROUP BY d ORDER BY d`,
          [days, TZ]
        ),
        pool.query(
          `SELECT EXTRACT(dow FROM v.created_at AT TIME ZONE $2::text)::int AS dow,
                  EXTRACT(hour FROM v.created_at AT TIME ZONE $2::text)::int AS hr,
                  COUNT(*)::int AS n
           FROM post_visits v WHERE v.created_at > ${since} GROUP BY 1, 2`,
          [days, TZ]
        ),
        pool.query(
          `SELECT COUNT(*) FILTER (WHERE created_at > now() - interval '30 minutes')::int AS now30,
                  COUNT(*)::int AS day24
           FROM post_visits WHERE created_at > now() - interval '24 hours'`
        ),
        pool.query(
          `SELECT p.slug, p.title, COUNT(*)::int AS visits
           FROM post_visits v JOIN posts p ON p.id = v.post_id
           WHERE v.created_at > now() - interval '24 hours'
           GROUP BY p.slug, p.title ORDER BY visits DESC LIMIT 1`
        ),
      ]);

      const cur = totals.rows[0];
      const prev = prevTot.rows[0];
      const pct = (a, b) => (b > 0 ? Math.round(((a - b) * 100) / b) : (a > 0 ? null : 0)); // null = "new"
      const deltas = {};
      ['visits', 'whatsapp', 'facebook', 'search', 'newsletter'].forEach((k) => { deltas[k] = { prev: prev[k], pct: pct(cur[k], prev[k]) }; });

      // Heatmap: Mon..Sun x 0..23 (timezone = config.timezone)
      const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const order = [1, 2, 3, 4, 5, 6, 0];
      const grid = order.map(() => Array(24).fill(0));
      heat.rows.forEach((r) => { const i = order.indexOf(r.dow); if (i >= 0 && r.hr >= 0 && r.hr < 24) grid[i][r.hr] = r.n; });
      let heatMax = 0, best = null;
      const hourTot = Array(24).fill(0), dayTot = Array(7).fill(0);
      grid.forEach((row, di) => row.forEach((n, h) => {
        hourTot[h] += n; dayTot[di] += n;
        if (n > heatMax) { heatMax = n; best = { di, h, n }; }
      }));
      const bestHour = hourTot.indexOf(Math.max(...hourTot));
      const bestDayIdx = dayTot.indexOf(Math.max(...dayTot));
      const hh = (h) => { const x = h % 12 === 0 ? 12 : h % 12; return x + (h < 12 ? ' AM' : ' PM'); };

      // Smart insights (Roman Urdu)
      const insights = [];
      const total = cur.visits;
      if (total > 0) {
        const g = deltas.visits.pct;
        if (g === null) insights.push({ icon: '🚀', tone: 'up', text: `Pichle ${days} din mein koi visit nahi tha, ab ${total} aa chuke hain. Shandar shuruaat!` });
        else if (g > 0) insights.push({ icon: '📈', tone: 'up', text: `Visits pichle ${days} din ke muqable mein ${g}% barh gaye (${prev.visits} → ${total}).` });
        else if (g < 0) insights.push({ icon: '📉', tone: 'down', text: `Visits pichle ${days} din se ${Math.abs(g)}% kam hain (${prev.visits} → ${total}). Naya post ya share karke dekho.` });
        else insights.push({ icon: '➖', tone: 'flat', text: `Visits pichle ${days} din ke barabar hain (${total}).` });

        const peak = daily.rows.reduce((m, d) => (d.visits > m.visits ? d : m), { visits: -1 });
        if (peak.visits > 0) insights.push({ icon: '🏔️', tone: 'up', text: `Sab se zyada visits ${peak.label} ko aaye: ${peak.visits}.` });

        if (sources.rows.length) {
          const top = sources.rows[0];
          insights.push({ icon: '🧭', tone: 'flat', text: `Sab se bara source "${top.source}" hai, total traffic ka ${Math.round((top.visits * 100) / total)}%.` });
        }
        if (best) insights.push({ icon: '⏰', tone: 'up', text: `Best time: ${DAY_NAMES[order[best.di]]} ko ${hh(best.h)} ke aas paas sab se zyada log aate hain. Post usse thora pehle daalo.` });
      }
      if (hot.rows[0]) insights.push({ icon: '🔥', tone: 'up', text: `Abhi ka hot post: "${hot.rows[0].title}" (pichle 24 ghante mein ${hot.rows[0].visits} visits).` });

      extra = {
        deltas,
        prevDaily: prevDaily.rows.map((r) => r.visits),
        heat: {
          grid, max: heatMax,
          days: order.map((d) => DAY_NAMES[d].slice(0, 3)),
          bestHour: hourTot[bestHour] > 0 ? hh(bestHour) : null,
          bestDay: dayTot[bestDayIdx] > 0 ? DAY_NAMES[order[bestDayIdx]] : null,
          bestCell: best ? { day: DAY_NAMES[order[best.di]], hour: hh(best.h), n: best.n } : null,
        },
        live: { now30: live.rows[0].now30, day24: live.rows[0].day24, hot: hot.rows[0] || null },
        insights,
      };
    } catch (err) {
      console.error('[analytics] extra:', err.message);
    }

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

    // Audience: age / gender / country / repeat clicks (alag try: migration_v23 na chali ho to baaqi analytics phir bhi chale)
    let audience = null;
    try {
      const [tot, ages, genders, countries, buckets, top, recent] = await Promise.all([
        pool.query(
          `SELECT COUNT(*)::int AS clicks,
                  COUNT(DISTINCT visitor)::int AS people,
                  COUNT(*) FILTER (WHERE user_id IS NOT NULL)::int AS member_clicks,
                  COUNT(*) FILTER (WHERE country IS NOT NULL)::int AS with_country
           FROM post_visits WHERE created_at > ${since} AND visitor IS NOT NULL`,
          [days]
        ),
        pool.query(
          `SELECT COALESCE(age_group, 'Unknown') AS label, COUNT(*)::int AS clicks, COUNT(DISTINCT visitor)::int AS people
           FROM post_visits WHERE created_at > ${since} AND visitor IS NOT NULL GROUP BY 1`,
          [days]
        ),
        pool.query(
          `SELECT COALESCE(gender, 'unknown') AS label, COUNT(*)::int AS clicks, COUNT(DISTINCT visitor)::int AS people
           FROM post_visits WHERE created_at > ${since} AND visitor IS NOT NULL GROUP BY 1 ORDER BY clicks DESC`,
          [days]
        ),
        pool.query(
          `SELECT country AS code, COUNT(*)::int AS clicks, COUNT(DISTINCT visitor)::int AS people
           FROM post_visits WHERE created_at > ${since} AND visitor IS NOT NULL AND country IS NOT NULL
           GROUP BY country ORDER BY clicks DESC LIMIT 12`,
          [days]
        ),
        pool.query(
          `WITH per AS (
             SELECT visitor, COUNT(*)::int AS n FROM post_visits
             WHERE created_at > ${since} AND visitor IS NOT NULL GROUP BY visitor
           )
           SELECT CASE WHEN n = 1 THEN '1 time' WHEN n = 2 THEN '2 times' WHEN n <= 5 THEN '3-5 times'
                       WHEN n <= 10 THEN '6-10 times' ELSE '11+ times' END AS label,
                  MIN(n)::int AS lo, COUNT(*)::int AS people
           FROM per GROUP BY 1 ORDER BY lo`,
          [days]
        ),
        pool.query(
          `SELECT visitor, MAX(user_id) AS uid, COUNT(*)::int AS clicks, COUNT(DISTINCT post_id)::int AS posts,
                  MAX(country) AS country, MAX(gender) AS gender, MAX(age_group) AS age_group, MAX(created_at) AS last_seen
           FROM post_visits WHERE created_at > ${since} AND visitor IS NOT NULL
           GROUP BY visitor ORDER BY clicks DESC, last_seen DESC LIMIT 10`,
          [days]
        ),
        // Recent visitors with IP (migration_v50 na chali ho to khali, baaqi analytics na ruke)
        pool.query(
          `SELECT v.created_at, v.ip, v.city, v.country, v.source, v.visitor, v.user_id, p.title, p.slug,
                  v.device, v.os, v.browser, v.brand, v.inapp,
                  i.isp, i.is_vpn, i.is_proxy, i.is_tor, i.is_hosting, i.is_mobile
           FROM post_visits v JOIN posts p ON p.id = v.post_id
           LEFT JOIN ip_info i ON i.ip = v.ip
           WHERE v.created_at > ${since} AND v.ip IS NOT NULL
           ORDER BY v.created_at DESC LIMIT 50`,
          [days]
        ).catch((e) => {
          if (e.code !== '42703' && e.code !== '42P01') throw e; // migration_v55 baaqi: purani query
          return pool.query(
            `SELECT v.created_at, v.ip, v.city, v.country, v.source, v.visitor, v.user_id, p.title, p.slug
             FROM post_visits v JOIN posts p ON p.id = v.post_id
             WHERE v.created_at > ${since} AND v.ip IS NOT NULL
             ORDER BY v.created_at DESC LIMIT 50`,
            [days]
          ).catch((e2) => { if (e2.code !== '42703') throw e2; return { rows: [] }; });
        }),
      ]);

      // Top visitors mein jo members hain unke naam
      const uids = [...top.rows.map((r) => r.uid), ...recent.rows.map((r) => r.user_id)].filter(Boolean);
      const names = {};
      if (uids.length) {
        (await pool.query('SELECT id, username FROM users WHERE id = ANY($1::int[])', [uids]))
          .rows.forEach((u) => { names[u.id] = u.username; });
      }
      const t = tot.rows[0];
      const ageMap = Object.fromEntries(ages.rows.map((r) => [r.label, r]));
      audience = {
        totals: {
          clicks: t.clicks, people: t.people, members: t.member_clicks,
          avg: t.people ? Math.round((t.clicks / t.people) * 10) / 10 : 0,
          returning: buckets.rows.filter((b) => b.lo > 1).reduce((a, b) => a + b.people, 0),
          countryPct: t.clicks ? Math.round((t.with_country * 100) / t.clicks) : 0,
        },
        ages: [...AGE_GROUPS, 'Unknown'].map((label) => ({ label, clicks: (ageMap[label] || {}).clicks || 0, people: (ageMap[label] || {}).people || 0 })),
        genders: genders.rows,
        countries: countries.rows.map((r) => ({ ...r, name: countryName(r.code), flag: flag(r.code) })),
        buckets: buckets.rows,
        recent: recent.rows.map((r) => ({
          ...r,
          who: r.user_id && names[r.user_id] ? names[r.user_id] : 'Guest #' + String(r.visitor || '').slice(-4),
          member: !!(r.user_id && names[r.user_id]),
          countryName: r.country ? countryName(r.country) : '-',
          flag: r.country ? flag(r.country) : '',
        })),
        top: top.rows.map((r) => ({
          ...r,
          who: r.uid && names[r.uid] ? names[r.uid] : 'Guest #' + String(r.visitor).slice(-4),
          member: !!(r.uid && names[r.uid]),
          countryName: r.country ? countryName(r.country) : '-',
          flag: r.country ? flag(r.country) : '',
        })),
      };
    } catch (err) {
      console.error('[analytics] audience (migration_v23.sql chali?):', err.message);
    }

    // Device + Browser aur ISP / VPN (alag try: migration_v55 na chali ho to baaqi analytics phir bhi chale)
    let tech = null, techMissing = false;
    try {
      const sinceV = `v.created_at > now() - ($1::int * interval '1 day')`;
      const [dev, brw, osr, brd, appr, ispTot, ispTop] = await Promise.all([
        pool.query(`SELECT COALESCE(device, 'unknown') AS label, COUNT(*)::int AS clicks, COUNT(DISTINCT visitor)::int AS people
                    FROM post_visits v WHERE ${sinceV} AND device IS NOT NULL GROUP BY 1 ORDER BY clicks DESC`, [days]),
        pool.query(`SELECT browser AS label, COUNT(*)::int AS clicks FROM post_visits v
                    WHERE ${sinceV} AND browser IS NOT NULL GROUP BY 1 ORDER BY clicks DESC LIMIT 8`, [days]),
        pool.query(`SELECT os AS label, COUNT(*)::int AS clicks FROM post_visits v
                    WHERE ${sinceV} AND os IS NOT NULL GROUP BY 1 ORDER BY clicks DESC LIMIT 6`, [days]),
        pool.query(`SELECT brand AS label, COUNT(*)::int AS clicks FROM post_visits v
                    WHERE ${sinceV} AND brand IS NOT NULL GROUP BY 1 ORDER BY clicks DESC LIMIT 8`, [days]),
        pool.query(`SELECT COUNT(*) FILTER (WHERE device IS NOT NULL)::int AS known,
                           COUNT(*) FILTER (WHERE inapp)::int AS inapp
                    FROM post_visits v WHERE ${sinceV}`, [days]),
        pool.query(`SELECT COUNT(*) FILTER (WHERE v.ip IS NOT NULL)::int AS with_ip,
                           COUNT(i.ip)::int AS looked,
                           COUNT(*) FILTER (WHERE i.is_vpn OR i.is_proxy OR i.is_tor)::int AS vpn,
                           COUNT(*) FILTER (WHERE i.is_hosting AND NOT (i.is_vpn OR i.is_proxy OR i.is_tor))::int AS hosting,
                           COUNT(*) FILTER (WHERE i.is_mobile AND NOT (i.is_vpn OR i.is_proxy OR i.is_tor OR i.is_hosting))::int AS mobile,
                           COUNT(DISTINCT v.ip) FILTER (WHERE v.ip IS NOT NULL AND i.ip IS NULL)::int AS pending_ips
                    FROM post_visits v LEFT JOIN ip_info i ON i.ip = v.ip WHERE ${sinceV}`, [days]),
        pool.query(`SELECT COALESCE(i.isp, 'Unknown') AS isp,
                           BOOL_OR(i.is_vpn OR i.is_proxy OR i.is_tor) AS vpn, BOOL_OR(i.is_hosting) AS hosting, BOOL_OR(i.is_mobile) AS mobile,
                           COUNT(*)::int AS clicks, COUNT(DISTINCT v.visitor)::int AS people
                    FROM post_visits v JOIN ip_info i ON i.ip = v.ip WHERE ${sinceV}
                    GROUP BY 1 ORDER BY clicks DESC LIMIT 10`, [days]),
      ]);
      const sumC = (rows) => rows.reduce((a, r) => a + r.clicks, 0);
      const withPct = (rows) => { const t = sumC(rows) || 1; return rows.map((r) => ({ ...r, pct: Math.round((r.clicks * 100) / t) })); };
      const it = ispTot.rows[0];
      tech = {
        known: appr.rows[0].known,
        inapp: appr.rows[0].inapp,
        inappPct: appr.rows[0].known ? Math.round((appr.rows[0].inapp * 100) / appr.rows[0].known) : 0,
        devices: withPct(dev.rows), browsers: withPct(brw.rows), oses: withPct(osr.rows), brands: withPct(brd.rows),
        isp: {
          withIp: it.with_ip, looked: it.looked, pending: it.pending_ips,
          vpn: it.vpn, hosting: it.hosting, mobile: it.mobile,
          vpnPct: it.looked ? Math.round((it.vpn * 100) / it.looked) : 0,
          hostingPct: it.looked ? Math.round((it.hosting * 100) / it.looked) : 0,
          mobilePct: it.looked ? Math.round((it.mobile * 100) / it.looked) : 0,
          top: ispTop.rows,
        },
      };
      ipinfo.backfill(40); // purane IPs ka ISP bhi dheere dheere bharta rahe (background)
    } catch (err) {
      if (err.code === '42703' || err.code === '42P01') techMissing = true;
      console.error('[analytics] tech (migration_v55.sql chali?):', err.message);
    }

    // Group-wise performance (alag try: migration_v42 na chali ho to baaqi analytics phir bhi chale)
    let groupStats = [];
    try {
      groupStats = (await pool.query(
        `SELECT g.id, g.name, g.platform,
                COALESCE(s.shared, 0)::int AS shared,
                COALESCE(v.visits, 0)::int AS visits,
                COALESCE(v.people, 0)::int AS people,
                v.last_visit, tp.title AS top_title, tp.slug AS top_slug
         FROM share_groups g
         LEFT JOIN (SELECT campaign, COUNT(*) AS visits, COUNT(DISTINCT visitor) AS people, MAX(created_at) AS last_visit
                    FROM post_visits WHERE campaign IS NOT NULL AND created_at > ${since} GROUP BY campaign) v ON v.campaign = g.utm
         LEFT JOIN (SELECT group_id, COUNT(*) AS shared FROM share_posted
                    WHERE created_at > ${since} GROUP BY group_id) s ON s.group_id = g.id
         LEFT JOIN LATERAL (SELECT p.title, p.slug FROM post_visits v2 JOIN posts p ON p.id = v2.post_id
                            WHERE v2.campaign = g.utm AND v2.created_at > ${since}
                            GROUP BY p.id, p.title, p.slug ORDER BY COUNT(*) DESC LIMIT 1) tp ON true
         ORDER BY visits DESC, lower(g.name)`, [days])).rows;
    } catch (err) {
      console.error('[analytics] groups (migration_v42.sql chali?):', err.message);
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
      audience,
      extra,
      groupStats,
      tech,
      techMissing,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// ---------- BOTS TAB (admin) ----------
async function botsTab(req, res, days) {
  try {
    const since = `created_at > now() - ($1::int * interval '1 day')`;
    const [tot, kinds, bots, paths, recent, daily, human] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS hits, COUNT(DISTINCT bot)::int AS bots, COUNT(DISTINCT ip)::int AS ips,
                         COUNT(*) FILTER (WHERE bot = 'Facebook preview')::int AS fb_preview,
                         COUNT(*) FILTER (WHERE kind = 'search')::int AS search_hits
                  FROM bot_visits WHERE ${since}`, [days]),
      pool.query(`SELECT kind AS label, COUNT(*)::int AS clicks FROM bot_visits WHERE ${since} GROUP BY 1 ORDER BY clicks DESC`, [days]),
      pool.query(`SELECT bot, kind, COUNT(*)::int AS hits, COUNT(DISTINCT path)::int AS pages, MAX(created_at) AS last_seen
                  FROM bot_visits WHERE ${since} GROUP BY bot, kind ORDER BY hits DESC LIMIT 15`, [days]),
      pool.query(`SELECT path, COUNT(*)::int AS hits, COUNT(*) FILTER (WHERE bot = 'Facebook preview')::int AS fb,
                         COUNT(*) FILTER (WHERE kind = 'search')::int AS search
                  FROM bot_visits WHERE ${since} AND path IS NOT NULL GROUP BY path ORDER BY hits DESC LIMIT 10`, [days]),
      pool.query(`SELECT created_at, bot, kind, path, ip, country, ua FROM bot_visits WHERE ${since} ORDER BY created_at DESC LIMIT 40`, [days]),
      pool.query(
        `SELECT to_char(d, 'DD Mon') AS label, COUNT(b.id)::int AS hits
         FROM generate_series(
                date_trunc('day', now() AT TIME ZONE $2::text) - (($1::int - 1) * interval '1 day'),
                date_trunc('day', now() AT TIME ZONE $2::text), interval '1 day') AS d
         LEFT JOIN bot_visits b ON date_trunc('day', b.created_at AT TIME ZONE $2::text) = d
         GROUP BY d ORDER BY d`, [days, TZ]),
      pool.query(`SELECT COUNT(*)::int AS n FROM post_visits WHERE ${since}`, [days]),
    ]);
    const t = tot.rows[0];
    const kt = kinds.rows.reduce((a, r) => a + r.clicks, 0) || 1;
    res.render('analytics-bots', {
      title: 'Analytics · Bots',
      days,
      missing: false,
      totals: { ...t, human: human.rows[0].n, botPct: (t.hits + human.rows[0].n) ? Math.round((t.hits * 100) / (t.hits + human.rows[0].n)) : 0 },
      kinds: kinds.rows.map((r) => ({ ...r, pct: Math.round((r.clicks * 100) / kt) })),
      bots: bots.rows,
      paths: paths.rows,
      recent: recent.rows,
      daily: daily.rows,
    });
  } catch (err) {
    const missing = err.code === '42P01';
    if (!missing) console.error('[analytics] bots:', err.message);
    res.render('analytics-bots', { title: 'Analytics · Bots', days, missing, totals: null, kinds: [], bots: [], paths: [], recent: [], daily: [] });
  }
}

// ---------- VISITOR JOURNEY (admin) ----------
// Ek visitor ne kab, kahan se aa kar, kaun kaun si post / product dekhi, aur order kiya ya nahi.
router.get('/analytics/visitor/:vid', requireAdmin, async (req, res) => {
  const vid = String(req.params.vid || '');
  if (!/^(u\d{1,9}|[a-f0-9]{16})$/.test(vid)) {
    return res.status(404).render('404', { code: 404, title: 'Not found', message: 'Visitor id galat hai.' });
  }
  // naya query (device / ISP) pehle, na ho to purana; dono na chalein to khali
  const q = async (a, b) => {
    try { return (await pool.query(a, [vid])).rows; }
    catch (e) {
      if (e.code !== '42703' && e.code !== '42P01') throw e;
      try { return (await pool.query(b, [vid])).rows; }
      catch (e2) { if (e2.code === '42703' || e2.code === '42P01') return []; throw e2; }
    }
  };
  try {
    const DEV = `v.ip, v.city, v.country, v.device, v.os, v.browser, v.brand, v.inapp,
                 i.isp, i.is_vpn, i.is_proxy, i.is_tor, i.is_hosting, i.is_mobile`;
    const [posts, prods, orders] = await Promise.all([
      q(`SELECT 'post' AS kind, v.created_at, v.source, v.medium, v.campaign, v.referrer, p.title, p.slug, ${DEV}
         FROM post_visits v JOIN posts p ON p.id = v.post_id LEFT JOIN ip_info i ON i.ip = v.ip
         WHERE v.visitor = $1 ORDER BY v.created_at DESC LIMIT 300`,
        `SELECT 'post' AS kind, v.created_at, v.source, v.medium, v.referrer, p.title, p.slug
         FROM post_visits v JOIN posts p ON p.id = v.post_id WHERE v.visitor = $1 ORDER BY v.created_at DESC LIMIT 300`),
      q(`SELECT 'product' AS kind, v.created_at, v.source, v.medium, v.campaign, v.referrer, pr.name AS title, ${DEV}
         FROM product_visits v JOIN products pr ON pr.id = v.product_id LEFT JOIN ip_info i ON i.ip = v.ip
         WHERE v.visitor = $1 ORDER BY v.created_at DESC LIMIT 300`,
        `SELECT 'product' AS kind, v.created_at, v.source, v.medium, v.referrer, pr.name AS title
         FROM product_visits v JOIN products pr ON pr.id = v.product_id WHERE v.visitor = $1 ORDER BY v.created_at DESC LIMIT 300`),
      q(`SELECT 'order' AS kind, created_at, product_name AS title, qty, total_rs, status FROM orders WHERE visitor = $1 ORDER BY created_at DESC LIMIT 50`,
        `SELECT 'order' AS kind, created_at, product_name AS title, qty, total_rs, status FROM orders WHERE visitor = $1 ORDER BY created_at DESC LIMIT 50`),
    ]);

    const steps = [...posts, ...prods, ...orders]
      .map((r) => ({ ...r, t: new Date(r.created_at).getTime() }))
      .sort((a, b) => a.t - b.t);

    // Session: 30 minute se zyada gap = nayi session
    const GAP = 30 * 60 * 1000;
    const sessions = [];
    steps.forEach((st) => {
      let cur = sessions[sessions.length - 1];
      if (!cur || st.t - cur.end > GAP) { cur = { start: st.t, end: st.t, steps: [] }; sessions.push(cur); }
      st.gap = cur.steps.length ? st.t - cur.steps[cur.steps.length - 1].t : 0;
      cur.steps.push(st); cur.end = st.t;
    });
    sessions.reverse(); // sab se nayi pehle

    const views = steps.filter((x) => x.kind !== 'order');
    const uniq = (arr) => [...new Set(arr.filter(Boolean))];
    const devices = uniq(views.map((x) => x.device ? [x.brand, x.device, x.browser].filter(Boolean).join(' · ') : null));
    const ispMap = {};
    views.forEach((x) => {
      if (x.ip) ispMap[x.ip] = { ip: x.ip, isp: x.isp || null, vpn: !!(x.is_vpn || x.is_proxy || x.is_tor), hosting: !!x.is_hosting, mobile: !!x.is_mobile, city: x.city, country: x.country };
    });

    let who = null;
    const m = vid.match(/^u(\d+)$/);
    if (m) who = (await pool.query('SELECT username FROM users WHERE id = $1', [parseInt(m[1], 10)])).rows[0] || null;

    res.render('analytics-visitor', {
      title: 'Visitor journey',
      vid,
      who: who ? who.username : null,
      summary: {
        total: views.length,
        sessions: sessions.length,
        orders: orders.length,
        first: steps.length ? steps[0].t : null,
        last: steps.length ? steps[steps.length - 1].t : null,
        firstSource: views.length ? (views[0].source || 'direct') : null,
        countries: uniq(views.map((x) => x.country)).map((c) => ({ name: countryName(c), flag: flag(c) })),
        devices,
        networks: Object.values(ispMap),
      },
      sessions,
    });
  } catch (err) {
    console.error('[analytics] journey:', err);
    res.status(500).send('Server error');
  }
});

// ---------- ANALYTICS CSV EXPORT (admin) ----------
const csvCell = (v) => {
  let t = String(v === null || v === undefined ? '' : v);
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; // Excel formula injection se bachao
  return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
};
router.get('/analytics/export.csv', requireAdmin, async (req, res) => {
  const days = [7, 30, 90].includes(parseInt(req.query.days, 10)) ? parseInt(req.query.days, 10) : 30;
  try {
    const since = `now() - ($1::int * interval '1 day')`;
    const [daily, sources, posts] = await Promise.all([
      pool.query(
        `SELECT to_char(d, 'YYYY-MM-DD') AS day, COUNT(v.id)::int AS visits
         FROM generate_series(
                date_trunc('day', now() AT TIME ZONE $2::text) - (($1::int - 1) * interval '1 day'),
                date_trunc('day', now() AT TIME ZONE $2::text), interval '1 day') AS d
         LEFT JOIN post_visits v ON date_trunc('day', v.created_at AT TIME ZONE $2::text) = d
         GROUP BY d ORDER BY d`, [days, TZ]),
      pool.query(`SELECT source, COUNT(*)::int AS visits FROM post_visits WHERE created_at > ${since} GROUP BY source ORDER BY visits DESC`, [days]),
      pool.query(
        `SELECT p.title, p.slug, COUNT(v.id)::int AS visits,
                COUNT(*) FILTER (WHERE v.source = 'whatsapp')::int AS whatsapp,
                COUNT(*) FILTER (WHERE v.source = 'facebook')::int AS facebook
         FROM post_visits v JOIN posts p ON p.id = v.post_id WHERE v.created_at > ${since}
         GROUP BY p.id, p.slug, p.title ORDER BY visits DESC LIMIT 50`, [days]),
    ]);
    let groupRows = [];
    try {
      groupRows = (await pool.query(
        `SELECT g.name, g.platform, COUNT(v.id)::int AS visits, COUNT(DISTINCT v.visitor)::int AS people
         FROM share_groups g
         LEFT JOIN post_visits v ON v.campaign = g.utm AND v.created_at > ${since}
         GROUP BY g.id ORDER BY visits DESC`, [days])).rows;
    } catch (e) { /* migration_v42 baaqi */ }
    const line = (a) => a.map(csvCell).join(',');
    const out = [
      line(['Report', `Last ${days} days`]), '',
      'DAILY VISITS', line(['Date', 'Visits']), ...daily.rows.map((r) => line([r.day, r.visits])), '',
      'TRAFFIC SOURCES', line(['Source', 'Visits']), ...sources.rows.map((r) => line([r.source, r.visits])), '',
      'TOP POSTS', line(['Title', 'Slug', 'Visits', 'WhatsApp', 'Facebook']), ...posts.rows.map((r) => line([r.title, r.slug, r.visits, r.whatsapp, r.facebook])),
      ...(groupRows.length ? ['', 'GROUPS', line(['Group', 'Platform', 'Visits', 'People']), ...groupRows.map((r) => line([r.name, r.platform, r.visits, r.people]))] : []),
    ].join('\r\n');
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="analytics-${days}d.csv"`);
    res.send('\ufeff' + out);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
