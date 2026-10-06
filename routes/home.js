// Akhbar jaisa home page ("/"). Community feed ab "/?tab=all" par hai (navbar mein "Feed").
// Feed ke apne query params (tab, user, before, partial, posted...) aayein to ye route chhod deta hai (next) taake feed chale.
const express = require('express');
const pool = require('../db');
const config = require('../config');
const sponsorLib = require('../lib/sponsor');

const router = express.Router();
const LIVE = 'p.is_draft = false AND p.publish_at <= now()';
const FEED_KEYS = ['tab', 'user', 'before', 'partial', 'posted', 'err', 'notice', 'deleted', 'reported'];

// Har category ka apna (hamesha wahi) rang: chip, section ki patti aur link ke liye
const PALETTE = ['#0a6b4d', '#2563eb', '#c2410c', '#7c3aed', '#be185d', '#0e7490', '#a16207', '#4d7c0f'];
const catColor = (name) => {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

// Post ki shuruaat ka saaf text (markdown / html hata kar)
const plain = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/[#*_`>[\]()!~|]+/g, ' ').replace(/\s+/g, ' ').trim();
const previewOf = (p) => {
  if (p.excerpt) return p.excerpt;
  const t = plain(p.content);
  return t.length > 150 ? t.slice(0, 150).trim() + '...' : t;
};

function ago(d) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 1000));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'} ago`;
  if (s < 60) return 'just now';
  if (s < 3600) return plural(Math.floor(s / 60), 'minute');
  if (s < 86400) return plural(Math.floor(s / 3600), 'hour');
  if (s < 86400 * 30) return plural(Math.floor(s / 86400), 'day');
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: config.timezone || 'Asia/Karachi' });
}

// content ka sirf shuru ka hissa (preview ke liye), parhai ka waqt poore text se SQL mein
const COLS = `p.id, p.slug, p.title, p.excerpt, LEFT(p.content, 700) AS content, p.category, p.cover_url, p.views,
  p.publish_at AS created_at, u.username,
  GREATEST(CEIL(array_length(regexp_split_to_array(trim(p.content), '\\s+'), 1) / 200.0), 1)::int AS reading_time`;

const shape = (p) => ({ ...p, preview: previewOf(p), ago: ago(p.created_at), color: catColor(p.category) });

router.get('/', async (req, res, next) => {
  if (FEED_KEYS.some((k) => k in req.query)) return next();
  try {
    const latestQ = pool.query(
      `SELECT ${COLS} FROM posts p JOIN users u ON u.id = p.user_id WHERE ${LIVE} ORDER BY p.publish_at DESC LIMIT 14`
    );
    const catsQ = pool.query(
      `SELECT p.category, COUNT(*)::int AS total FROM posts p WHERE ${LIVE} GROUP BY p.category ORDER BY total DESC, p.category LIMIT 3`
    );
    const readQ = pool.query(
      `SELECT p.id, p.slug, p.title, p.views, p.category FROM posts p
       WHERE ${LIVE} AND p.publish_at > now() - interval '30 days' ORDER BY p.views DESC, p.publish_at DESC LIMIT 5`
    );
    const [latest, cats, recentRead] = await Promise.all([latestQ, catsQ, readQ]);

    const rows = latest.rows.map(shape);

    // Slider: pehle tasveer wali (max 4); kam hon to sab se nayi baghair tasveer wali se 3 tak bhar do
    const slides = rows.filter((p) => p.cover_url).slice(0, 4);
    for (const p of rows) { if (slides.length >= 3) break; if (!slides.includes(p)) slides.push(p); }
    slides.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const rest1 = rows.filter((p) => !slides.includes(p));
    const pair = rest1.slice(0, 2);
    const strip = rest1.slice(2, 8);

    // Sab se zyada parhi gayi: 30 din mein; kam hon to purani mashhoor se bhar do
    let mostRead = recentRead.rows;
    if (mostRead.length < 5) {
      const have = mostRead.map((p) => p.id);
      const more = await pool.query(
        `SELECT p.id, p.slug, p.title, p.views, p.category FROM posts p
         WHERE ${LIVE} AND p.id <> ALL($1::int[]) ORDER BY p.views DESC, p.publish_at DESC LIMIT $2`,
        [have, 5 - mostRead.length]
      );
      mostRead = mostRead.concat(more.rows);
    }

    // Category sections (upar dikhai ja chuki posts dobara na aayein)
    const used = [...slides, ...pair, ...strip].map((p) => p.id);
    let sections = [];
    if (cats.rows.length) {
      const sp = await pool.query(
        `SELECT * FROM (
           SELECT ${COLS}, ROW_NUMBER() OVER (PARTITION BY p.category ORDER BY p.publish_at DESC) AS rn
           FROM posts p JOIN users u ON u.id = p.user_id
           WHERE ${LIVE} AND p.category = ANY($1::text[]) AND p.id <> ALL($2::int[])
         ) t WHERE rn <= 4 ORDER BY category, rn`,
        [cats.rows.map((c) => c.category), used]
      );
      sections = cats.rows
        .map((c) => {
          const list = sp.rows.filter((r) => r.category === c.category).map(shape);
          return { name: c.category, color: catColor(c.category), lead: list[0] || null, rest: list.slice(1) };
        })
        .filter((s) => s.lead);
    }

    const base = config.siteUrl || `${req.protocol}://${req.get('host')}`;
    const liveContest = await sponsorLib.homeContest(req, res, base);

    res.render('home', {
      title: 'Khabzo - Cricket, News aur Community',
      metaDescription: `${config.siteName}: cricket, news and web development posts plus a community feed. Read, share, like and comment.`,
      slides, pair, strip, mostRead, sections, liveContest,
      ticker: rows.slice(0, 8).map((p) => ({ slug: p.slug, title: p.title })),
    });
  } catch (err) { next(err); }
});

module.exports = router;
