// Group Poster: groups ki list save, har group ka alag UTM link, caption copy, "aaj post ho gayi" ✓.
// Per-group analytics /analytics page par ("Group-wise performance") aur is page par (is post ke views).
const crypto = require('crypto');
const express = require('express');
const pool = require('../db');
const config = require('../config');
const { slugify } = require('../lib/slug');

const router = express.Router();
const TZ = config.timezone;
const PLATFORMS = ['whatsapp', 'facebook', 'telegram', 'instagram', 'other'];
const MAX_GROUPS = 300;
const baseUrlOf = (req) => config.siteUrl || `${req.protocol}://${req.get('host')}`;

const requireAdmin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    return res.status(403).render('404', { code: 403, title: 'Not allowed', message: 'Only the blog owner can do this.' });
  }
  next();
};

const LIVE = 'is_draft = false AND publish_at <= now()';

const stripMarkup = (t) =>
  String(t || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const previewOf = (p) => {
  if (p.excerpt) return p.excerpt;
  const plain = stripMarkup(p.content);
  return plain.length > 130 ? plain.substring(0, 130) + '...' : plain;
};

const detectPlatform = (link, fallback) => {
  if (/whatsapp\.com|wa\.me/i.test(link)) return 'whatsapp';
  if (/facebook\.com|fb\.com|fb\.me/i.test(link)) return 'facebook';
  if (/t\.me|telegram\./i.test(link)) return 'telegram';
  if (/instagram\.com/i.test(link)) return 'instagram';
  return fallback;
};

// Sirf /poster/<number> par wapas bhejna (open redirect se bachao)
const backTo = (b) => (/^\/poster\/\d+$/.test(String(b || '')) ? b : '/poster');

// ---------- /poster : sabse naya live post kholo ----------
router.get('/poster', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(`SELECT id FROM posts WHERE ${LIVE} ORDER BY publish_at DESC LIMIT 1`);
    if (!r.rows[0]) return res.redirect('/dashboard');
    res.redirect('/poster/' + r.rows[0].id);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// ---------- /poster/:id ----------
router.get('/poster/:id', requireAdmin, async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return next();
  const id = parseInt(req.params.id, 10);
  try {
    const postR = await pool.query(
      `SELECT id, slug, title, excerpt, content FROM posts WHERE id = $1 AND ${LIVE}`, [id]);
    const post = postR.rows[0];
    if (!post) {
      return res.status(404).render('404', { code: 404, title: 'Post not found', message: 'Sirf published post share ho sakti hai.' });
    }

    let groups = [];
    let setupNeeded = false;
    try {
      const gr = await pool.query(
        `SELECT g.id, g.name, g.platform, g.link, g.utm,
                EXISTS (SELECT 1 FROM share_posted s
                        WHERE s.group_id = g.id AND s.post_id = $1
                          AND s.posted_on = (now() AT TIME ZONE $2::text)::date) AS done,
                COALESCE(v.visits, 0)::int AS visits, COALESCE(v.people, 0)::int AS people
         FROM share_groups g
         LEFT JOIN (SELECT campaign, COUNT(*) AS visits, COUNT(DISTINCT visitor) AS people
                    FROM post_visits WHERE post_id = $1 AND campaign IS NOT NULL GROUP BY campaign) v
                ON v.campaign = g.utm
         ORDER BY g.platform, lower(g.name)`,
        [id, TZ]
      );
      groups = gr.rows;
    } catch (err) {
      if (err.code === '42P01' || err.code === '42703') setupNeeded = true; // migration_v42 baaqi
      else throw err;
    }

    const recent = (await pool.query(
      `SELECT id, title FROM posts WHERE ${LIVE} ORDER BY publish_at DESC LIMIT 15`)).rows;

    const base = baseUrlOf(req);
    const postUrl = `${base}/posts/${post.slug}`;
    groups = groups.map((g) => ({
      ...g,
      url: `${postUrl}?utm_source=${g.platform}&utm_medium=group&utm_campaign=${g.utm}`,
    }));

    res.render('poster', {
      title: 'Group Poster',
      robots: 'noindex,nofollow',
      post,
      preview: previewOf(post),
      groups,
      recent,
      setupNeeded,
      doneCount: groups.filter((g) => g.done).length,
      PLATFORMS,
      flash: req.query.msg || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// ---------- groups add (ek ya kai, har line: Naam | link) ----------
router.post('/poster/groups', requireAdmin, async (req, res) => {
  const back = backTo(req.body.back);
  const fallback = PLATFORMS.includes(req.body.platform) ? req.body.platform : 'whatsapp';
  const lines = String(req.body.groups || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 100);
  let added = 0;
  let skipped = 0;
  try {
    const have = (await pool.query('SELECT COUNT(*)::int AS n FROM share_groups')).rows[0].n;
    for (const line of lines) {
      if (have + added >= MAX_GROUPS) { skipped++; continue; }
      let name = line;
      let link = '';
      const m = line.match(/^(.*?)\s*[|,]\s*(https?:\/\/\S+)\s*$/i) || line.match(/^(.*?)\s+(https?:\/\/\S+)\s*$/i);
      if (m) { name = m[1].trim(); link = m[2].trim(); }
      else if (/^https?:\/\//i.test(line)) { name = ''; link = line; }
      if (!name) name = link ? link.replace(/^https?:\/\/(www\.)?/i, '').slice(0, 40) : '';
      name = name.slice(0, 80);
      link = link.slice(0, 500);
      if (!name) { skipped++; continue; }
      const platform = detectPlatform(link, fallback);
      const utm = (slugify(name).replace(/^post$/, 'grp').slice(0, 30) + '-' + crypto.randomBytes(2).toString('hex')).slice(0, 60);
      await pool.query('INSERT INTO share_groups (name, platform, link, utm) VALUES ($1, $2, $3, $4)',
        [name, platform, link || null, utm]);
      added++;
    }
    const msg = `${added} group save hue` + (skipped ? `, ${skipped} skip (khali ya limit)` : '');
    res.redirect(back + '?msg=' + encodeURIComponent(msg));
  } catch (err) {
    console.error(err);
    res.redirect(back + '?msg=' + encodeURIComponent('Group save nahi hua. migration_v42.sql chali?'));
  }
});

// ---------- group delete ----------
router.post('/poster/groups/:gid/delete', requireAdmin, async (req, res) => {
  try {
    const gid = parseInt(req.params.gid, 10);
    if (gid) await pool.query('DELETE FROM share_groups WHERE id = $1', [gid]);
  } catch (err) {
    console.error(err);
  }
  res.redirect(backTo(req.body.back));
});

// ---------- ✓ toggle: "aaj is group mein post ho gayi" ----------
router.post('/poster/:id/tick/:gid', requireAdmin, async (req, res) => {
  const postId = parseInt(req.params.id, 10);
  const gid = parseInt(req.params.gid, 10);
  if (!postId || !gid) return res.status(400).json({ error: 'bad id' });
  try {
    const del = await pool.query(
      `DELETE FROM share_posted WHERE group_id = $1 AND post_id = $2
         AND posted_on = (now() AT TIME ZONE $3::text)::date`, [gid, postId, TZ]);
    if (del.rowCount > 0) return res.json({ done: false });
    await pool.query(
      `INSERT INTO share_posted (group_id, post_id, posted_on)
       VALUES ($1, $2, (now() AT TIME ZONE $3::text)::date) ON CONFLICT DO NOTHING`, [gid, postId, TZ]);
    res.json({ done: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed' });
  }
});

module.exports = router;
