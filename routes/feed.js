// Community Feed (Facebook jaisa): photo + text post, like, comment, share, report.
// Blog ke articles sirf owner likhta hai; feed mein har login user post kar sakta hai.
const express = require('express');
const pool = require('../db');
const config = require('../config');
const cloud = require('../lib/cloudinary');
const spam = require('../lib/spam');
const moderation = require('../lib/moderation');
const Feed = require('../lib/feed');
const Friends = require('../lib/friends');
const Blocks = require('../lib/blocks');
const Images = require('../lib/images');
const Groups = require('../lib/groups');
const { notifyUser } = require('../lib/notify');
const { detectImage } = require('./uploads');
const { isBot } = require('../lib/analytics');

const router = express.Router();
const BODY_MAX = 2000;
const COMMENT_MAX = 1000;
const toId = (v) => (/^\d{1,9}$/.test(String(v)) ? parseInt(v, 10) : null);
const baseUrl = (req) => config.siteUrl || `${req.protocol}://${req.get('host')}`;
const snippet = (s, n = 50) => (s.length > n ? s.slice(0, n - 3) + '...' : s);
const wantsJson = (req) => req.get('x-requested-with') === 'fetch';

const requireLogin = (req, res, next) => {
  if (!req.session.user) {
    return wantsJson(req) || req.path === '/upload-feed-image'
      ? res.status(401).json({ error: 'Please log in again.' })
      : res.redirect('/login');
  }
  next();
};

// Image ki row hatao, lekin sirf agar wo kisi feed post / profile photo se juri na ho aur owner ne hi upload ki ho
const dropImageIfOrphan = (imageId, ownerId) => Images.dropIfOrphan(imageId, ownerId);

// ---------- PHOTO UPLOAD (har login user) ----------
// Browser pehle photo ko max 1600px JPEG bana deta hai, body seedhi JPEG bytes (app.js mein express.raw, hadd 2 MB)
router.post('/upload-feed-image', requireLogin, async (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length === 0) return res.status(400).json({ error: 'Please choose an image.' });
  if (detectImage(buf) !== 'image/jpeg') return res.status(400).json({ error: 'Could not read this image. Please try a JPG or PNG photo.' });
  try {
    let remote = null;
    if (cloud.enabled()) {
      try { remote = (await cloud.uploadImage(buf, 'image/jpeg')).url; }
      catch (e) { console.error('[feed upload] Cloudinary fail, database mein save kar raha hoon:', e.message); }
    }
    const ins = await pool.query(
      'INSERT INTO images (mime, data, size, uploaded_by, remote_url) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      ['image/jpeg', remote ? null : buf, buf.length, req.session.user.id, remote]
    );
    res.json({ id: ins.rows[0].id });
  } catch (err) {
    console.error('[feed upload]', err.message);
    res.status(500).json({ error: 'Upload failed. Please try again.' });
  }
});

// Composer mein photo hata di (post nahi kiya): upload ki hui row saaf
router.post('/feed/image/discard', requireLogin, async (req, res) => {
  try {
    await dropImageIfOrphan(toId(req.body && req.body.id), req.session.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false });
  }
});

// Purane /feed links: ab feed home page par hai (query string saath jati hai)
router.get('/feed', (req, res) => {
  const i = req.originalUrl.indexOf('?');
  res.redirect(301, '/' + (i === -1 ? '' : req.originalUrl.slice(i)));
});

// ---------- FEED PAGE (home page) ----------
router.get('/', async (req, res, next) => {
  try {
    const me = req.session.user ? req.session.user.id : null;
    const isAdmin = res.locals.isAdmin;
    const tab = (req.query.tab === 'following' || req.query.tab === 'groups') && me ? req.query.tab : 'all';
    const before = toId(req.query.before);

    let author = null;
    if (req.query.user) {
      const a = await pool.query(
        'SELECT id, username FROM users WHERE lower(username) = lower($1) ORDER BY id LIMIT 1',
        [String(req.query.user).slice(0, 50)]
      );
      author = a.rows[0] || null;
      if (!author) return next();
    }

    const { posts, hasMore } = await Feed.list({ me, isAdmin, tab, authorId: author && author.id, before });
    await Feed.attach(posts, { me, isAdmin }, false);

    const common = {
      posts, f: null, tab, author, ago: Feed.timeAgo, shareBase: baseUrl(req), full: false,
    };

    // "Load more" button: sirf cards ka HTML (aur agla cursor header mein)
    if (req.query.partial === '1') {
      res.set('X-Next-Before', hasMore && posts.length ? String(posts[posts.length - 1].id) : '');
      return res.render('partials/feed-cards', common);
    }

    // Sidebar: naye blog posts + "people you may know" (kuch fail ho to feed phir bhi chale)
    let latestPosts = [];
    let people = [];
    try {
      const lp = await pool.query(
        `SELECT p.title, p.slug FROM posts p WHERE p.is_draft = false AND p.publish_at <= now() ORDER BY p.publish_at DESC LIMIT 4`
      );
      latestPosts = lp.rows;
    } catch (e) { console.error('[feed] latest posts:', e.message); }
    if (me) {
      try { people = await Friends.suggestions(me, 5); }
      catch (e) { console.error('[feed] suggestions (migration_v14 chali?):', e.message); }
    }

    // Right sidebar: mashhoor groups (migration_v20 na chali ho to feed phir bhi chale)
    let popularGroups = [];
    try { popularGroups = await Groups.popular(5, me || 0); }
    catch (e) { console.error('[feed] groups (migration_v20.sql chali?):', e.message); }

    res.render('feed', {
      ...common, popularGroups,
      title: author ? `${author.username} · Feed posts` : 'Community Feed',
      metaDescription: `Photos and posts from the ${config.siteName} community. Share your own photo, like and comment.`,
      nextBefore: hasMore && posts.length ? posts[posts.length - 1].id : null,
      latestPosts, people,
      flash: {
        posted: req.query.posted === '1',
        error: req.query.err ? String(req.query.err).slice(0, 200) : null,
        notice: req.query.notice ? String(req.query.notice).slice(0, 200) : null,
        deleted: req.query.deleted === '1',
        reported: req.query.reported === '1',
      },
    });
  } catch (err) { next(err); }
});

// ---------- SINGLE POST (share link: /feed/12) ----------
router.get('/feed/:id', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return next();
    const me = req.session.user ? req.session.user.id : null;
    const isAdmin = res.locals.isAdmin;
    const { posts } = await Feed.list({ me, isAdmin, onlyId: id, limit: 1 });
    const f = posts[0];
    if (!f) return next();
    await Feed.attach(posts, { me, isAdmin }, true);
    // Group ki post par group admin ko bhi delete ka haq (card / comment is flag se button dikhate hain)
    const groupAdmin = !!(f.group_id && me && (await Groups.roleOf(f.group_id, me)) === 'admin');

    const base = baseUrl(req);
    const text = f.body ? snippet(f.body.replace(/\s+/g, ' '), 140) : 'Shared a photo';
    res.render('feed-post', {
      f, posts, ago: Feed.timeAgo, shareBase: base, full: true, groupAdmin,
      title: `${f.username}: ${snippet(text, 60)}`,
      metaDescription: text,
      ogType: 'article',
      ogImage: f.image_id ? `${base}/img/${f.image_id}` : res.locals.ogImage,
      ogImageCard: f.image_id ? false : res.locals.ogImageCard,
      flash: {
        notice: req.query.notice ? String(req.query.notice).slice(0, 200) : null,
        error: req.query.err ? String(req.query.err).slice(0, 200) : null,
        reported: req.query.reported === '1',
      },
    });
  } catch (err) { next(err); }
});

// ---------- VIEW COUNT ----------
// Browser jab card ko ~1 second screen par dekh leta hai to ids bhejta hai (ek browser session mein har post sirf ek baar).
// Bots, admin aur post ke apne owner ke views ginti mein nahi aate.
router.post('/feed/views', async (req, res) => {
  try {
    if (isBot(req) || res.locals.isAdmin) return res.json({ ok: true });
    const me = req.session.user ? req.session.user.id : 0;
    const ids = String(req.body.ids || '').split(',').map(toId).filter(Boolean).slice(0, 20);
    if (ids.length) {
      await pool.query(
        'UPDATE feed_posts SET views = views + 1 WHERE id = ANY($1::int[]) AND NOT is_hidden AND user_id <> $2',
        [ids, me]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[feed views] (migration_v19.sql chali?):', err.message);
    res.json({ ok: false });
  }
});

// ---------- CREATE POST ----------
router.post('/feed', requireLogin, async (req, res) => {
  const me = req.session.user;
  let home = '/'; // aam post: home feed. Group post: us group ka page
  const fail = (msg) => res.redirect(home + '?err=' + encodeURIComponent(msg));
  try {
    // Group ki post: group sach mein ho aur likhne wala uska member ho
    let groupId = null;
    if (req.body && req.body.group_id) {
      const gid = toId(req.body.group_id);
      const g = gid ? (await pool.query('SELECT id, slug FROM groups WHERE id = $1', [gid])).rows[0] : null;
      if (!g) return fail('Group not found.');
      home = '/groups/' + g.slug;
      if (!(await Groups.roleOf(g.id, me.id))) return fail('Join this group first to post in it.');
      groupId = g.id;
    }
    const body = String((req.body && req.body.body) || '').replace(/\r\n/g, '\n').trim();
    const imageId = toId(req.body && req.body.image_id);
    if (!body && !imageId) return fail('Write something or add a photo first.');
    if (body.length > BODY_MAX) return fail(`Post is too long (max ${BODY_MAX} characters).`);

    // Photo sach mein isi user ki upload ki hui ho, aur kisi aur post / profile photo ki na ho
    if (imageId) {
      const ok = await pool.query(
        `SELECT 1 FROM images WHERE id = $1 AND uploaded_by = $2 AND ${Images.unusedSql('$1')}`,
        [imageId, me.id]
      );
      if (!ok.rows[0]) return fail('That photo could not be used. Please add it again.');
    }

    let held = false;
    let heldReason = '';
    if (body) {
      const verdict = await spam.check(body, { userId: me.id, isAdmin: res.locals.isAdmin });
      if (verdict.action === 'block') return fail(verdict.message.replace('comment', 'post'));
      held = verdict.action === 'hold';
      heldReason = verdict.reason;

      const dup = await pool.query(
        `SELECT 1 FROM feed_posts WHERE user_id = $1 AND lower(trim(body)) = lower($2)
           AND created_at > now() - interval '10 minutes' LIMIT 1`,
        [me.id, body]
      );
      if (dup.rows[0]) return fail('You already posted this a moment ago.');
    }

    const ins = await pool.query(
      'INSERT INTO feed_posts (user_id, body, image_id, is_hidden, group_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [me.id, body, imageId, held, groupId]
    );
    if (held) {
      await moderation.holdForReview('feed_post', ins.rows[0].id, heldReason);
      return res.redirect(home + '?notice=' + encodeURIComponent('Your post is waiting for review by the site owner. Only you can see it until then.'));
    }
    res.redirect(home + '?posted=1');
  } catch (err) {
    console.error('[feed create] (migration_v18.sql chali?)', err.message);
    fail('Could not save your post. Please try again.');
  }
});

// ---------- LIKE (JSON) ----------
router.post('/feed/:id/like', requireLogin, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad request' });
  const me = req.session.user;
  try {
    const pr = await pool.query(
      `SELECT f.user_id, f.body FROM feed_posts f WHERE f.id = $1 AND (NOT f.is_hidden OR f.user_id = $2 OR $3::boolean)
         AND ${Groups.visiblePostSql('f', '$2', '$3')}`,
      [id, me.id, res.locals.isAdmin]
    );
    const post = pr.rows[0];
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.user_id !== me.id && (await Blocks.isBlockedEither(me.id, post.user_id))) {
      return res.status(403).json({ error: 'Not available' });
    }

    const del = await pool.query('DELETE FROM feed_likes WHERE post_id = $1 AND user_id = $2', [id, me.id]);
    let liked = false;
    if (del.rowCount === 0) {
      const ins = await pool.query(
        'INSERT INTO feed_likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1', [id, me.id]
      );
      liked = true;
      if (ins.rowCount && post.user_id !== me.id) {
        notifyUser(post.user_id, `${me.username} liked your post${post.body ? ': "' + snippet(post.body, 40) + '"' : ''}`, `/feed/${id}`);
      }
    }
    const c = await pool.query('SELECT COUNT(*)::int AS n FROM feed_likes WHERE post_id = $1', [id]);
    res.json({ ok: true, liked, likes: c.rows[0].n });
  } catch (err) {
    console.error('[feed like]', err.message);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// ---------- COMMENT ----------
router.post('/feed/:id/comments', requireLogin, async (req, res) => {
  const id = toId(req.params.id);
  const me = req.session.user;
  const json = wantsJson(req);
  const back = (q) => res.redirect(`/feed/${id}${q || ''}`);
  const fail = (msg, code = 400) => (json ? res.status(code).json({ error: msg }) : back('?err=' + encodeURIComponent(msg) + '#comments'));
  if (!id) return json ? res.status(400).json({ error: 'Bad request' }) : res.redirect('/');

  try {
    const body = String((req.body && req.body.body) || '').replace(/\r\n/g, '\n').trim();
    if (!body || body.length > COMMENT_MAX) return fail(`Comment must be between 1 and ${COMMENT_MAX} characters.`);

    const pr = await pool.query(
      `SELECT f.user_id, f.body FROM feed_posts f WHERE f.id = $1 AND (NOT f.is_hidden OR f.user_id = $2 OR $3::boolean)
         AND ${Groups.visiblePostSql('f', '$2', '$3')}`,
      [id, me.id, res.locals.isAdmin]
    );
    const post = pr.rows[0];
    if (!post) return fail('Post not found.', 404);
    if (post.user_id !== me.id && (await Blocks.isBlockedEither(me.id, post.user_id))) return fail('Not available.', 403);

    const verdict = await spam.check(body, { userId: me.id, isAdmin: res.locals.isAdmin });
    if (verdict.action === 'block') return fail(verdict.message);
    const held = verdict.action === 'hold';

    const dup = await pool.query(
      `SELECT 1 FROM feed_comments WHERE user_id = $1 AND post_id = $2 AND lower(trim(body)) = lower($3)
         AND created_at > now() - interval '10 minutes' LIMIT 1`,
      [me.id, id, body]
    );
    if (dup.rows[0]) return fail('You already posted this comment a moment ago.');

    const ins = await pool.query(
      'INSERT INTO feed_comments (post_id, user_id, body, is_hidden) VALUES ($1, $2, $3, $4) RETURNING id, created_at',
      [id, me.id, body, held]
    );
    const cid = ins.rows[0].id;
    if (held) await moderation.holdForReview('feed_comment', cid, verdict.reason);
    else if (post.user_id !== me.id) {
      notifyUser(post.user_id, `${me.username} commented on your post: "${snippet(body, 50)}"`, `/feed/${id}#c${cid}`);
    }

    if (!json) return back(held ? '?notice=' + encodeURIComponent('Your comment is waiting for review by the site owner. Only you can see it until then.') : `#c${cid}`);

    const c = { id: cid, post_id: id, user_id: me.id, body, is_hidden: held, created_at: ins.rows[0].created_at, username: me.username };
    const f = { id, user_id: post.user_id };
    res.render('partials/feed-comment', { c, f, ago: Feed.timeAgo }, (err, html) => {
      if (err) { console.error('[feed comment render]', err.message); return res.status(500).json({ error: 'Something went wrong.' }); }
      res.json({ ok: true, held, html });
    });
  } catch (err) {
    console.error('[feed comment]', err.message);
    fail('Something went wrong. Please try again.', 500);
  }
});

// ---------- DELETE ----------
router.post('/feed/:id/delete', requireLogin, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.redirect('/');
  const me = req.session.user;
  try {
    // Post ka owner, site admin, ya us group ka admin
    const r = await pool.query(
      `DELETE FROM feed_posts WHERE id = $1 AND ($3::boolean OR user_id = $2
         OR EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = feed_posts.group_id AND gm.user_id = $2 AND gm.role = 'admin'))
       RETURNING user_id, image_id, group_id`,
      [id, me.id, res.locals.isAdmin]
    );
    let back = '/';
    if (r.rows[0]) {
      await dropImageIfOrphan(r.rows[0].image_id, r.rows[0].user_id);
      if (r.rows[0].group_id) {
        const g = await pool.query('SELECT slug FROM groups WHERE id = $1', [r.rows[0].group_id]);
        if (g.rows[0]) back = '/groups/' + g.rows[0].slug;
      }
    }
    res.redirect(back + '?deleted=1');
  } catch (err) {
    console.error('[feed delete]', err.message);
    res.redirect('/');
  }
});

router.post('/feed/comments/:id/delete', requireLogin, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.redirect('/');
  const me = req.session.user;
  try {
    // Comment ka apna owner, us post ka owner, ya admin
    const r = await pool.query(
      `DELETE FROM feed_comments c USING feed_posts f
       WHERE c.id = $1 AND f.id = c.post_id AND ($3::boolean OR c.user_id = $2 OR f.user_id = $2
         OR EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = f.group_id AND gm.user_id = $2 AND gm.role = 'admin'))
       RETURNING c.post_id`,
      [id, me.id, res.locals.isAdmin]
    );
    res.redirect(r.rows[0] ? `/feed/${r.rows[0].post_id}#comments` : '/');
  } catch (err) {
    console.error('[feed comment delete]', err.message);
    res.redirect('/');
  }
});

module.exports = router;
