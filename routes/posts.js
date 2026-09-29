const express = require('express');
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');
const pool = require('../db');

const router = express.Router();
const PER_PAGE = 6;
const REACTION_EMOJIS = ['👍', '❤️', '🔥', '😂', '😢'];

// Apne groups banane ke baad ye do links yahan replace kar dein
const COMMUNITY_WHATSAPP_URL = 'https://chat.whatsapp.com/REPLACE_WITH_YOUR_INVITE_LINK';
const COMMUNITY_FACEBOOK_URL = 'https://facebook.com/groups/REPLACE_WITH_YOUR_GROUP';

const CATEGORIES = [
  'Cricket',
  'Video Editing',
  'AI & ML',
  'Freelancing',
  'Web Development',
  'Content Creation',
  'General',
];

// ---------- Helpers ----------
const requireLogin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    return res.status(403).render('404', {
      title: 'Not allowed',
      message: 'Only the blog owner can do this.',
    });
  }
  next();
};

const toId = (v) => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) ? n : null;
};

const renderMarkdown = (md) =>
  sanitizeHtml(marked.parse(md), {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['h1', 'h2', 'img']),
    allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, img: ['src', 'alt'] },
    allowedSchemes: ['http', 'https'],
  });

const parseTags = (raw) => {
  if (!raw) return [];
  return [...new Set(
    raw.split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
      .map((t) => t.slice(0, 30))
  )].slice(0, 8);
};

const saveTagsForPost = async (postId, tagNames) => {
  await pool.query('DELETE FROM post_tags WHERE post_id = $1', [postId]);
  for (const name of tagNames) {
    const tagRow = await pool.query(
      `INSERT INTO tags (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [name]
    );
    await pool.query(
      'INSERT INTO post_tags (post_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [postId, tagRow.rows[0].id]
    );
  }
};

const makePreview = (post) => {
  if (post.excerpt) return post.excerpt;
  const plain = post.content.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*_`>~]/g, '');
  return plain.length > 130 ? plain.substring(0, 130) + '...' : plain;
};

const validatePost = (body) => {
  const title = (body.title || '').trim();
  const excerpt = (body.excerpt || '').trim();
  const content = (body.content || '').trim();
  const category = body.category;
  const cover = (body.cover_url || '').trim();

  let error = null;
  if (!title || !content) error = 'Title and content are required.';
  else if (title.length > 200) error = 'Title must be 200 characters or less.';
  else if (excerpt.length > 300) error = 'Summary must be 300 characters or less.';
  else if (!CATEGORIES.includes(category)) error = 'Please choose a valid category.';
  else if (cover && !/^https?:\/\/\S+$/i.test(cover)) error = 'Cover image must be a valid http(s) URL.';

  return {
    error,
    data: { title, excerpt: excerpt || null, content, category, cover_url: cover || null },
  };
};

// ---------- HOME ----------
router.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  const category = (req.query.category || '').trim();
  const tag = (req.query.tag || '').trim().toLowerCase();
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const offset = (page - 1) * PER_PAGE;

  const where = `
    WHERE ($1::text = '' OR p.title ILIKE '%' || $1::text || '%' OR p.content ILIKE '%' || $1::text || '%')
      AND ($2::text = '' OR p.category = $2::text)
      AND ($3::text = '' OR EXISTS (
        SELECT 1 FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
        WHERE pt.post_id = p.id AND t.name = $3::text
      ))`;

  try {
    const [postsResult, countResult, catResult, popularResult, tagsResult] = await Promise.all([
      pool.query(
        `SELECT p.id, p.title, p.excerpt, p.content, p.category, p.cover_url, p.views, p.created_at,
                u.username,
                (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id)::int AS like_count,
                (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id)::int AS comment_count,
                COALESCE((SELECT array_agg(t.name ORDER BY t.name)
                          FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
                          WHERE pt.post_id = p.id), '{}') AS tags
         FROM posts p JOIN users u ON u.id = p.user_id
         ${where}
         ORDER BY p.created_at DESC
         LIMIT $4 OFFSET $5`,
        [q, category, tag, PER_PAGE, offset]
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM posts p ${where}`, [q, category, tag]),
      pool.query('SELECT category, COUNT(*)::int AS total FROM posts GROUP BY category ORDER BY total DESC'),
      pool.query('SELECT id, title, views FROM posts ORDER BY views DESC, created_at DESC LIMIT 5'),
      pool.query(
        `SELECT t.name, COUNT(*)::int AS total
         FROM tags t JOIN post_tags pt ON pt.tag_id = t.id
         GROUP BY t.name ORDER BY total DESC, t.name ASC LIMIT 15`
      ),
    ]);

    const totalPosts = countResult.rows[0].total;
    const posts = postsResult.rows.map((p) => ({ ...p, preview: makePreview(p) }));

    res.render('index', {
      title: 'My Blog',
      posts,
      categories: catResult.rows,
      popular: popularResult.rows,
      tags: tagsResult.rows,
      totalPosts,
      totalPages: Math.max(Math.ceil(totalPosts / PER_PAGE), 1),
      page,
      q,
      category,
      tag,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// ---------- NEWSLETTER SUBSCRIBE ----------
router.post('/subscribe', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const backPath = (req.get('Referrer') || '/').split('#')[0].split('?')[0];
  const sep = backPath.includes('?') ? '&' : '?';

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.redirect(`${backPath}${sep}subscribeError=${encodeURIComponent('Please enter a valid email address.')}`);
  }

  try {
    await pool.query(
      'INSERT INTO subscribers (email) VALUES ($1) ON CONFLICT (email) DO NOTHING',
      [email]
    );
    res.redirect(`${backPath}${sep}subscribed=1`);
  } catch (err) {
    console.error(err);
    res.redirect(`${backPath}${sep}subscribeError=${encodeURIComponent('Something went wrong. Please try again.')}`);
  }
});

// ---------- RSS FEED ----------
router.get('/rss.xml', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, excerpt, content, created_at FROM posts ORDER BY created_at DESC LIMIT 20`
    );
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

    const items = result.rows.map((p) => `
    <item>
      <title>${esc(p.title)}</title>
      <link>${baseUrl}/posts/${p.id}</link>
      <guid>${baseUrl}/posts/${p.id}</guid>
      <pubDate>${new Date(p.created_at).toUTCString()}</pubDate>
      <description>${esc(p.excerpt || p.content.slice(0, 200))}</description>
    </item>`).join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>My Blog</title>
  <link>${baseUrl}</link>
  <description>Notes and tutorials on cricket, video editing, AI, freelancing and web development.</description>
  ${items}
</channel>
</rss>`;

    res.type('application/rss+xml').send(xml);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// ---------- SITEMAP ----------
router.get('/sitemap.xml', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, created_at FROM posts ORDER BY created_at DESC');
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const staticUrls = ['', '/about', '/leaderboard', '/community'];

    const staticXml = staticUrls.map((u) => `
  <url><loc>${baseUrl}${u}</loc></url>`).join('');

    const postsXml = result.rows.map((p) => `
  <url>
    <loc>${baseUrl}/posts/${p.id}</loc>
    <lastmod>${new Date(p.created_at).toISOString()}</lastmod>
  </url>`).join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${staticXml}${postsXml}
</urlset>`;

    res.type('application/xml').send(xml);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// ---------- ROBOTS.TXT ----------
router.get('/robots.txt', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.type('text/plain').send(`User-agent: *\nAllow: /\n\nSitemap: ${baseUrl}/sitemap.xml`);
});

// ---------- LEADERBOARD ----------
router.get('/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.username, COUNT(*)::int AS comment_count
       FROM comments c JOIN users u ON u.id = c.user_id
       GROUP BY u.username
       ORDER BY comment_count DESC
       LIMIT 10`
    );
    res.render('leaderboard', { title: 'Top Commenters', leaders: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// ---------- COMMUNITY ----------
router.get('/community', (req, res) => {
  res.render('community', {
    title: 'Join Our Community',
    whatsappUrl: COMMUNITY_WHATSAPP_URL,
    facebookUrl: COMMUNITY_FACEBOOK_URL,
  });
});

// ---------- ABOUT ----------
router.get('/about', (req, res) => {
  res.render('about', { title: 'About' });
});

// ---------- BOOKMARKS (reader) ----------
router.get('/bookmarks', requireLogin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.title, p.category, p.created_at, u.username
       FROM bookmarks b
       JOIN posts p ON p.id = b.post_id
       JOIN users u ON u.id = p.user_id
       WHERE b.user_id = $1
       ORDER BY b.created_at DESC`,
      [req.session.user.id]
    );
    res.render('bookmarks', { title: 'My Bookmarks', posts: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// ---------- DASHBOARD (admin) ----------
router.get('/dashboard', requireAdmin, async (req, res) => {
  try {
    const [stats, list] = await Promise.all([
      pool.query(`SELECT
        (SELECT COUNT(*) FROM posts)::int AS posts,
        (SELECT COALESCE(SUM(views), 0) FROM posts)::int AS views,
        (SELECT COUNT(*) FROM comments)::int AS comments,
        (SELECT COUNT(*) FROM users)::int AS users`),
      pool.query(`SELECT p.id, p.title, p.category, p.views, p.created_at,
        (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id)::int AS likes,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id)::int AS comments
        FROM posts p ORDER BY p.created_at DESC`),
    ]);
    res.render('dashboard', { title: 'Dashboard', stats: stats.rows[0], posts: list.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// ---------- NEW POST (admin) ----------
router.get('/posts/new', requireAdmin, (req, res) => {
  res.render('editor', {
    title: 'Write a Post',
    heading: 'Write a New Post',
    action: '/posts',
    error: null,
    categories: CATEGORIES,
    form: {},
  });
});

router.post('/posts', requireAdmin, async (req, res) => {
  const { error, data } = validatePost(req.body);
  if (error) {
    return res.render('editor', {
      title: 'Write a Post',
      heading: 'Write a New Post',
      action: '/posts',
      error,
      categories: CATEGORIES,
      form: req.body,
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO posts (user_id, title, excerpt, content, category, cover_url)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.session.user.id, data.title, data.excerpt, data.content, data.category, data.cover_url]
    );
    await saveTagsForPost(result.rows[0].id, parseTags(req.body.tags));
    res.redirect('/posts/' + result.rows[0].id);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// ---------- EDIT POST (admin) ----------
router.get('/posts/:id/edit', requireAdmin, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(404).render('404', { title: 'Not Found' });

  try {
    const result = await pool.query('SELECT * FROM posts WHERE id = $1', [id]);
    const post = result.rows[0];
    if (!post) return res.status(404).render('404', { title: 'Not Found' });

    const tagsResult = await pool.query(
      `SELECT t.name FROM tags t JOIN post_tags pt ON pt.tag_id = t.id
       WHERE pt.post_id = $1 ORDER BY t.name`,
      [id]
    );
    post.tags = tagsResult.rows.map((r) => r.name).join(', ');

    res.render('editor', {
      title: 'Edit Post',
      heading: 'Edit Post',
      action: `/posts/${id}/edit`,
      error: null,
      categories: CATEGORIES,
      form: post,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

router.post('/posts/:id/edit', requireAdmin, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(404).render('404', { title: 'Not Found' });

  const { error, data } = validatePost(req.body);
  if (error) {
    return res.render('editor', {
      title: 'Edit Post',
      heading: 'Edit Post',
      action: `/posts/${id}/edit`,
      error,
      categories: CATEGORIES,
      form: req.body,
    });
  }

  try {
    await pool.query(
      `UPDATE posts
       SET title = $1, excerpt = $2, content = $3, category = $4, cover_url = $5
       WHERE id = $6`,
      [data.title, data.excerpt, data.content, data.category, data.cover_url, id]
    );
    await saveTagsForPost(id, parseTags(req.body.tags));
    res.redirect('/posts/' + id);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// ---------- SINGLE POST ----------
router.get('/posts/:id', async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(404).render('404', { title: 'Not Found' });

  const uid = req.session.user ? req.session.user.id : null;

  try {
    // Views sirf readers ke count hote hain (admin ke nahi)
    if (!res.locals.isAdmin) {
      await pool.query('UPDATE posts SET views = views + 1 WHERE id = $1', [id]);
    }

    const result = await pool.query(
      `SELECT p.*, u.username,
              (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id)::int AS like_count,
              EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = $2::int) AS liked,
              EXISTS (SELECT 1 FROM bookmarks b WHERE b.post_id = p.id AND b.user_id = $2::int) AS bookmarked
       FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.id = $1`,
      [id, uid]
    );
    const post = result.rows[0];
    if (!post) return res.status(404).render('404', { title: 'Not Found' });

    const [related, comments, tagsResult, reactionResult, myReactionResult] = await Promise.all([
      pool.query(
        `SELECT id, title, created_at FROM posts
         WHERE category = $1 AND id <> $2
         ORDER BY created_at DESC LIMIT 3`,
        [post.category, post.id]
      ),
      pool.query(
        `SELECT c.id, c.body, c.created_at, c.user_id, u.username
         FROM comments c JOIN users u ON u.id = c.user_id
         WHERE c.post_id = $1
         ORDER BY c.created_at ASC`,
        [id]
      ),
      pool.query(
        `SELECT t.name FROM tags t JOIN post_tags pt ON pt.tag_id = t.id
         WHERE pt.post_id = $1 ORDER BY t.name`,
        [id]
      ),
      pool.query('SELECT emoji, COUNT(*)::int AS total FROM reactions WHERE post_id = $1 GROUP BY emoji', [id]),
      uid
        ? pool.query('SELECT emoji FROM reactions WHERE post_id = $1 AND user_id = $2', [id, uid])
        : Promise.resolve({ rows: [] }),
    ]);

    const reactionCounts = {};
    REACTION_EMOJIS.forEach((e) => { reactionCounts[e] = 0; });
    reactionResult.rows.forEach((r) => { reactionCounts[r.emoji] = r.total; });
    const myReaction = myReactionResult.rows[0] ? myReactionResult.rows[0].emoji : null;

    const words = post.content.trim().split(/\s+/).length;
    const shareUrl = `${req.protocol}://${req.get('host')}/posts/${post.id}`;

    res.render('post', {
      title: post.title,
      metaDescription: post.excerpt || undefined,
      post,
      contentHtml: renderMarkdown(post.content),
      related: related.rows,
      comments: comments.rows,
      tags: tagsResult.rows.map((r) => r.name),
      reactionEmojis: REACTION_EMOJIS,
      reactionCounts,
      myReaction,
      shareUrl,
      readingTime: Math.max(Math.ceil(words / 200), 1),
      commentError: req.query.commentError || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// ---------- DELETE POST (admin) ----------
router.post('/posts/:id/delete', requireAdmin, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.redirect('/dashboard');

  try {
    await pool.query('DELETE FROM posts WHERE id = $1', [id]);
    res.redirect('/dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// ---------- REACTION toggle ----------
router.post('/posts/:id/react', requireLogin, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.redirect('/');
  const emoji = req.body.emoji;
  const uid = req.session.user.id;

  if (!REACTION_EMOJIS.includes(emoji)) return res.redirect('/posts/' + id);

  try {
    const existing = await pool.query(
      'SELECT emoji FROM reactions WHERE post_id = $1 AND user_id = $2',
      [id, uid]
    );
    if (existing.rows[0] && existing.rows[0].emoji === emoji) {
      await pool.query('DELETE FROM reactions WHERE post_id = $1 AND user_id = $2', [id, uid]);
    } else {
      await pool.query(
        `INSERT INTO reactions (post_id, user_id, emoji) VALUES ($1, $2, $3)
         ON CONFLICT (post_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji, created_at = now()`,
        [id, uid, emoji]
      );
    }
  } catch (err) {
    console.error(err);
  }
  res.redirect('/posts/' + id + '#reactions');
});

// ---------- LIKE toggle ----------
router.post('/posts/:id/like', requireLogin, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.redirect('/');
  const uid = req.session.user.id;

  try {
    const del = await pool.query('DELETE FROM likes WHERE post_id = $1 AND user_id = $2', [id, uid]);
    if (del.rowCount === 0) {
      await pool.query(
        'INSERT INTO likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [id, uid]
      );
    }
  } catch (err) {
    console.error(err);
    return res.redirect('/');
  }
  res.redirect('/posts/' + id);
});

// ---------- BOOKMARK toggle ----------
router.post('/posts/:id/bookmark', requireLogin, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.redirect('/');
  const uid = req.session.user.id;

  try {
    const del = await pool.query('DELETE FROM bookmarks WHERE post_id = $1 AND user_id = $2', [id, uid]);
    if (del.rowCount === 0) {
      await pool.query(
        'INSERT INTO bookmarks (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [id, uid]
      );
    }
  } catch (err) {
    console.error(err);
    return res.redirect('/');
  }
  res.redirect('/posts/' + id);
});

// ---------- COMMENTS ----------
router.post('/posts/:id/comments', requireLogin, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.redirect('/');

  const body = (req.body.body || '').trim();
  if (!body || body.length > 1000) {
    const msg = encodeURIComponent('Comment must be between 1 and 1000 characters.');
    return res.redirect(`/posts/${id}?commentError=${msg}#comments`);
  }

  try {
    await pool.query(
      'INSERT INTO comments (post_id, user_id, body) VALUES ($1, $2, $3)',
      [id, req.session.user.id, body]
    );
  } catch (err) {
    console.error(err);
    return res.redirect('/');
  }
  res.redirect(`/posts/${id}#comments`);
});

router.post('/comments/:id/delete', requireLogin, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.redirect('/');

  const { id: uid, role } = req.session.user;

  try {
    // Admin sab ke comments delete kar sakta hai, reader sirf apne
    const result = await pool.query(
      `DELETE FROM comments WHERE id = $1 AND ($3 = 'admin' OR user_id = $2) RETURNING post_id`,
      [id, uid, role]
    );
    const postId = result.rows[0] ? result.rows[0].post_id : null;
    res.redirect(postId ? `/posts/${postId}#comments` : '/');
  } catch (err) {
    console.error(err);
    res.redirect('/');
  }
});

module.exports = router;