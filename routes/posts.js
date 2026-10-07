const express = require('express');
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');
const pool = require('../db');
const config = require('../config');
const { trackVisit, isBot } = require('../lib/analytics');
const { notifyUser } = require('../lib/notify');
const { uniqueSlug } = require('../lib/slug');
const { addToc } = require('../lib/toc');
const { postLd, listLd } = require('../lib/seo');
const card = require('../lib/card');
const polls = require('../lib/polls');
const sponsorLib = require('../lib/sponsor');
const indexnow = require('../lib/indexnow');
const spam = require('../lib/spam');
const moderation = require('../lib/moderation');
const earnings = require('../lib/earnings');

const router = express.Router();
const PER_PAGE = Math.min(Math.max(parseInt(process.env.POSTS_PER_PAGE, 10) || 6, 1), 30);
const REACTION_EMOJIS = ['👍', '❤️', '🔥', '😂', '😢'];

// Sirf published posts (draft aur future-scheduled posts public ko nazar nahi aatin)
const LIVE = 'p.is_draft = false AND p.publish_at <= now()';
const TZ = config.timezone;
const baseUrlOf = (req) => config.siteUrl || `${req.protocol}://${req.get('host')}`;
// Uploaded image ka URL relative hota hai (/img/5); OG tags aur emails ko poora URL chahiye
const absUrl = (base, u) => (u && u.startsWith('/') ? base + u : u);

// Home page ka URL (filters + page number ke saath)
const homeUrl = ({ q, category, tag }, page = 1) => {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (category) params.set('category', category);
  if (tag) params.set('tag', tag);
  if (page > 1) params.set('page', page);
  const qs = params.toString();
  return '/blog' + (qs ? '?' + qs : '');
};

const CATEGORIES = [
  'Cricket',
  'Video Editing',
  'AI & ML',
  'Freelancing',
  'Web Development',
  'Content Creation',
  'General',
];

// Editor ki list: upar wali default categories + jitni categories aap ne posts mein khud bana li hain.
// (Nayi category banane ke liye alag table nahi: jab kisi post mein use hoti hai to list mein aa jati hai.)
async function getCategories() {
  try {
    const r = await pool.query('SELECT DISTINCT category FROM posts ORDER BY category');
    const extra = r.rows.map((x) => x.category).filter((c) => c && !CATEGORIES.includes(c));
    return [...CATEGORIES, ...extra];
  } catch (err) {
    console.error('getCategories:', err.message);
    return CATEGORIES;
  }
}

const cleanCategory = (v) =>
  String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

// ---------- Helpers ----------
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

const toId = (v) => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) ? n : null;
};


// Post ke andar vote contest (widget): editor mein dropdown se chuna jata hai
const getPollsForSelect = async () => {
  try {
    const r = await pool.query('SELECT id, title, kind FROM polls ORDER BY created_at DESC LIMIT 100');
    return r.rows;
  } catch (err) {
    return []; // migration_v9 na chali ho to editor phir bhi khule
  }
};
const savePostPoll = async (postId, raw) => {
  try {
    await pool.query('UPDATE posts SET poll_id = (SELECT id FROM polls WHERE id = $1) WHERE id = $2', [toId(raw), postId]);
  } catch (err) {
    console.error('[post poll]', err.message);
  }
};

// Post mein sirf apni uploaded video (/video/5) aur YouTube embed allowed hain; baaqi sab kuch (script, iframe wagaira) saaf ho jata hai.
const YT_EMBED = /^https:\/\/www\.youtube(-nocookie)?\.com\/embed\/[\w-]{11}(\?[\w=&-]*)?$/;
const OWN_VIDEO = /^\/video\/\d{1,9}$/;

const renderMarkdown = (md) =>
  sanitizeHtml(marked.parse(md), {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['h1', 'h2', 'img', 'video', 'iframe']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ['src', 'alt'],
      video: ['src', 'controls', 'preload', 'playsinline', 'class'],
      iframe: ['src', 'title', 'allowfullscreen', 'loading', 'class'],
    },
    allowedSchemes: ['http', 'https'],
    allowedIframeHostnames: ['www.youtube.com', 'www.youtube-nocookie.com'],
    transformTags: {
      video: (tagName, attribs) => ({
        tagName: 'video',
        attribs: { src: attribs.src, controls: 'controls', preload: 'metadata', playsinline: 'playsinline', class: 'post-video' },
      }),
      iframe: (tagName, attribs) => ({
        tagName: 'iframe',
        attribs: { src: attribs.src, title: attribs.title || 'Video', loading: 'lazy', allowfullscreen: 'allowfullscreen', class: 'post-embed' },
      }),
    },
    exclusiveFilter: (frame) =>
      (frame.tag === 'video' && !OWN_VIDEO.test(frame.attribs.src || '')) ||
      (frame.tag === 'iframe' && !YT_EMBED.test(frame.attribs.src || '')),
  });

// Preview/email/RSS ke liye markdown + HTML tags (video/iframe) hata kar sada text
const stripMarkup = (text) =>
  String(text).replace(/<[^>]*>/g, ' ').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*_`>~]/g, '').replace(/\s+/g, ' ').trim();

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

const readingTimeOf = (content) =>
  Math.max(Math.ceil(content.trim().split(/\s+/).length / 200), 1);

const makePreview = (post) => {
  if (post.excerpt) return post.excerpt;
  const plain = stripMarkup(post.content);
  return plain.length > 130 ? plain.substring(0, 130) + '...' : plain;
};

const validatePost = (body, knownCategories = CATEGORIES) => {
  const title = (body.title || '').trim();
  const excerpt = (body.excerpt || '').trim();
  const content = (body.content || '').trim();
  // "__new__" = dropdown mein "Add new category" chuna gaya, naam new_category mein aata hai
  let category = cleanCategory(body.category === '__new__' ? body.new_category : body.category);
  const existingCat = knownCategories.find((c) => c.toLowerCase() === category.toLowerCase());
  if (existingCat) category = existingCat; // "cricket" likhne par bhi wahi purani "Cricket" istemal ho
  const cover = (body.cover_url || '').trim();
  const slug = (body.slug || '').trim();
  const isDraft = body.status === 'draft';
  const publishAt = (body.publish_at || '').trim();
  const sendNewsletter = body.send_newsletter === 'on';

  let error = null;
  if (!title || !content) error = 'Title and content are required.';
  else if (title.length > 200) error = 'Title must be 200 characters or less.';
  else if (excerpt.length > 300) error = 'Summary must be 300 characters or less.';
  else if (!category) error = 'Please choose a category or type a new one.';
  else if (category.length > 50) error = 'Category name must be 50 characters or less.';
  else if (cover && !/^(https?:\/\/\S+|\/img\/\d+)$/i.test(cover)) error = 'Cover image must be an http(s) URL or an uploaded image.';
  else if (slug.length > 100) error = 'URL slug must be 100 characters or less.';
  else if (publishAt && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(publishAt)) error = 'Publish date is not valid.';

  return {
    error,
    data: {
      title, excerpt: excerpt || null, content, category, cover_url: cover || null, slug,
      is_draft: isDraft, publish_at: publishAt || null, send_newsletter: sendNewsletter,
    },
  };
};

// ---------- BLOG (pehle home tha, ab alag menu: /blog) ----------
router.get('/blog', async (req, res) => {
  const q = (req.query.q || '').trim();
  const category = (req.query.category || '').trim();
  const tag = (req.query.tag || '').trim().toLowerCase();
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const offset = (page - 1) * PER_PAGE;

  // Full-text search (GIN index) + title par partial match (jaise "node" -> "nodejs")
  const where = `
    WHERE ${LIVE}
      AND ($1::text = ''
           OR p.search_vector @@ websearch_to_tsquery('simple', $1::text)
           OR p.title ILIKE '%' || $1::text || '%')
      AND ($2::text = '' OR p.category = $2::text)
      AND ($3::text = '' OR EXISTS (
        SELECT 1 FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
        WHERE pt.post_id = p.id AND t.name = $3::text
      ))`;

  try {
    const [postsResult, countResult, catResult, popularResult, tagsResult] = await Promise.all([
      pool.query(
        `SELECT p.id, p.slug, p.title, p.excerpt, p.content, p.category, p.cover_url, p.views,
                p.publish_at AS created_at,
                u.username,
                (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id)::int AS like_count,
                (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id)::int AS comment_count,
                COALESCE((SELECT array_agg(t.name ORDER BY t.name)
                          FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
                          WHERE pt.post_id = p.id), '{}') AS tags
         FROM posts p JOIN users u ON u.id = p.user_id
         ${where}
         ORDER BY (CASE WHEN $1::text = '' THEN 0
                        ELSE ts_rank(p.search_vector, websearch_to_tsquery('simple', $1::text)) END) DESC,
                  p.publish_at DESC
         LIMIT $4 OFFSET $5`,
        [q, category, tag, PER_PAGE, offset]
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM posts p ${where}`, [q, category, tag]),
      pool.query(`SELECT p.category, COUNT(*)::int AS total FROM posts p WHERE ${LIVE} GROUP BY p.category ORDER BY total DESC`),
      pool.query(`SELECT p.id, p.slug, p.title, p.views FROM posts p WHERE ${LIVE} ORDER BY p.views DESC, p.publish_at DESC LIMIT 5`),
      pool.query(
        `SELECT t.name, COUNT(*)::int AS total
         FROM tags t JOIN post_tags pt ON pt.tag_id = t.id JOIN posts p ON p.id = pt.post_id
         WHERE ${LIVE}
         GROUP BY t.name ORDER BY total DESC, t.name ASC LIMIT 15`
      ),
    ]);

    const totalPosts = countResult.rows[0].total;
    const totalPages = Math.max(Math.ceil(totalPosts / PER_PAGE), 1);
    // Bahut bara page number: aakhri page par bhej do
    if (page > totalPages) return res.redirect(homeUrl({ q, category, tag }, totalPages));

    const posts = postsResult.rows.map((p) => ({
      ...p,
      preview: makePreview(p),
      readingTime: readingTimeOf(p.content),
    }));

    // Sab se garam / pin kiya hua live contest (sirf asli homepage par, search/filter/page 2 par nahi)
    const liveContest = !q && !category && !tag && page === 1 ? await sponsorLib.homeContest(req, res, baseUrlOf(req)) : null;

    // SEO: har filter / page ka apna title + description (warna sab pages ka title ek jaisa = duplicate)
    const site = config.siteName;
    const pageSfx = page > 1 ? ` - Page ${page}` : '';
    let seoTitle = `Blog: Cricket, Video Editing, AI & Web Development | ${site}`;
    let seoDesc = `Articles, tutorials and notes on cricket, video editing, AI, freelancing and web development from ${site}.`;
    const crumbs = [{ name: 'Home', url: baseUrlOf(req) + '/' }, { name: 'Blog', url: baseUrlOf(req) + '/blog' }];
    if (q) {
      seoTitle = `Search: ${q.slice(0, 50)} | ${site}`;
      seoDesc = `Search results for "${q.slice(0, 50)}" on ${site}.`;
    } else if (category) {
      seoTitle = `${category} Articles & Tutorials | ${site}`;
      seoDesc = `Read ${totalPosts} ${category} ${totalPosts === 1 ? 'post' : 'posts'} on ${site}: guides, tutorials and the latest updates.`;
      crumbs.push({ name: category, url: baseUrlOf(req) + homeUrl({ category }) });
    } else if (tag) {
      seoTitle = `#${tag} Posts | ${site}`;
      seoDesc = `All ${site} posts tagged "${tag}": ${totalPosts} ${totalPosts === 1 ? 'article' : 'articles'}.`;
      crumbs.push({ name: `#${tag}`, url: baseUrlOf(req) + homeUrl({ tag }) });
    }
    seoTitle += pageSfx;
    const listUrl = baseUrlOf(req) + homeUrl({ category, tag }, page);

    res.render('index', {
      title: seoTitle,
      metaDescription: seoDesc,
      // Search results patli content hoti hain: Google index na kare, par links follow kare
      robots: q ? 'noindex,follow' : null,
      jsonLd: q ? [] : listLd({ base: baseUrlOf(req), name: seoTitle, url: listUrl, description: seoDesc, posts, crumbs }),
      liveContest,
      posts,
      categories: catResult.rows,
      popular: popularResult.rows,
      tags: tagsResult.rows,
      totalPosts,
      totalPages,
      perPage: PER_PAGE,
      // Canonical: page 2 ka apna URL (warna Google usay page 1 ka duplicate samajhta hai)
      ogUrl: baseUrlOf(req) + homeUrl({ category, tag }, page),
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
      `SELECT p.id, p.slug, p.title, p.excerpt, p.content, p.category, p.cover_url, p.publish_at AS created_at,
              COALESCE(p.updated_at, p.publish_at) AS updated_at, u.username
       FROM posts p JOIN users u ON u.id = p.user_id
       WHERE ${LIVE} ORDER BY p.publish_at DESC LIMIT 30`
    );
    const baseUrl = baseUrlOf(req);
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const lastBuild = result.rows.length ? new Date(result.rows[0].updated_at) : new Date();

    const items = result.rows.map((p) => {
      const cover = absUrl(baseUrl, p.cover_url);
      return `
    <item>
      <title>${esc(p.title)}</title>
      <link>${baseUrl}/posts/${esc(p.slug)}</link>
      <guid isPermaLink="true">${baseUrl}/posts/${esc(p.slug)}</guid>
      <pubDate>${new Date(p.created_at).toUTCString()}</pubDate>
      <dc:creator>${esc(p.username)}</dc:creator>
      <category>${esc(p.category)}</category>
      <description>${esc(p.excerpt || stripMarkup(p.content).slice(0, 200))}</description>${cover ? `
      <media:thumbnail url="${esc(cover)}"/>` : ''}
    </item>`;
    }).join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
  <title>${esc(config.siteName)}</title>
  <link>${baseUrl}</link>
  <atom:link href="${baseUrl}/rss.xml" rel="self" type="application/rss+xml"/>
  <description>Notes and tutorials on cricket, video editing, AI, freelancing and web development.</description>
  <language>en</language>
  <lastBuildDate>${lastBuild.toUTCString()}</lastBuildDate>${items}
</channel>
</rss>`;

    res.set('Cache-Control', 'public, max-age=600');
    res.type('application/rss+xml').send(xml);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// ---------- SITEMAP ----------
const xmlEsc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
router.get('/sitemap.xml', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.slug, p.cover_url, COALESCE(p.updated_at, p.publish_at) AS lastmod FROM posts p WHERE ${LIVE} ORDER BY p.publish_at DESC LIMIT 5000`
    );
    const baseUrl = baseUrlOf(req);

    // Community feed ki public posts (hidden aur group ki posts nahi), taake Google /feed/ID pages dhoond sake
    let feedRows = [];
    try {
      const fr = await pool.query(
        `SELECT f.id, f.image_id, f.created_at,
                GREATEST(f.created_at, COALESCE((SELECT MAX(c.created_at) FROM feed_comments c WHERE c.post_id = f.id AND NOT c.is_hidden), f.created_at)) AS lastmod
         FROM feed_posts f
         WHERE NOT f.is_hidden AND f.group_id IS NULL
         ORDER BY f.id DESC LIMIT 5000`
      );
      feedRows = fr.rows;
    } catch (e) { console.error('[sitemap feed]', e.message); }

    // Category aur tag pages (ab har ka apna title / description hai)
    let catRows = [];
    let tagRows = [];
    try {
      catRows = (await pool.query(
        `SELECT p.category AS name, MAX(COALESCE(p.updated_at, p.publish_at)) AS lastmod FROM posts p WHERE ${LIVE} GROUP BY p.category`
      )).rows;
      tagRows = (await pool.query(
        `SELECT t.name, MAX(COALESCE(p.updated_at, p.publish_at)) AS lastmod
         FROM tags t JOIN post_tags pt ON pt.tag_id = t.id JOIN posts p ON p.id = pt.post_id
         WHERE ${LIVE} GROUP BY t.name ORDER BY COUNT(*) DESC LIMIT 200`
      )).rows;
    } catch (e) { console.error('[sitemap cats/tags]', e.message); }

    // Public groups (private nahi) aur vote contests (migration_v20/v22/v9 na chali ho to skip)
    let groupRows = [];
    let voteRows = [];
    try {
      groupRows = (await pool.query(
        `SELECT g.slug, g.created_at AS lastmod FROM groups g WHERE NOT COALESCE(g.is_private, false) ORDER BY g.created_at DESC LIMIT 1000`
      )).rows;
    } catch (e) { console.error('[sitemap groups]', e.message); }
    try {
      voteRows = (await pool.query(`SELECT p.id, p.created_at AS lastmod FROM polls p ORDER BY p.created_at DESC LIMIT 1000`)).rows;
    } catch (e) { console.error('[sitemap votes]', e.message); }

    // People's Court + petitions (migration_v34 na chali ho to skip)
  let courtRows = []; let petRows = [];
  try { courtRows = (await pool.query(`SELECT c.id, COALESCE(c.jury_ends_at, c.created_at) AS lastmod FROM court_cases c WHERE NOT c.is_hidden ORDER BY c.created_at DESC LIMIT 1000`)).rows; } catch (e) { console.error('[sitemap court]', e.message); }
  try { petRows = (await pool.query(`SELECT p.id, p.updated_at AS lastmod FROM petitions p WHERE NOT p.is_hidden AND p.status <> 'closed' ORDER BY p.updated_at DESC LIMIT 3000`)).rows; } catch (e) { console.error('[sitemap petitions]', e.message); }
  const newest = result.rows.length ? new Date(result.rows[0].lastmod).toISOString() : null;
    const lm = (d) => (d ? `\n    <lastmod>${new Date(d).toISOString()}</lastmod>` : '');
    const url = (loc, d, extra = '') => `\n  <url>\n    <loc>${xmlEsc(baseUrl + loc)}</loc>${lm(d)}${extra}\n  </url>`;
    const img = (u) => (u ? `\n    <image:image><image:loc>${xmlEsc(absUrl(baseUrl, u))}</image:loc></image:image>` : '');

    // Home / blog ki lastmod = sab se nayi post ki date (jhooti "aaj ki date" nahi: Google ka bharosa rehta hai)
    const staticXml = [
      url('/', newest), url('/blog', newest), url('/community', newest), url('/groups', null), url('/votes', null),
      url('/predictions', null), url('/leaderboard', null), url('/about', null), url('/hire', null),
    url('/court', null), url('/petitions', null), url('/cricket', null), url('/creators', null), url('/trends', null),
    ].join('');
    const postsXml = result.rows.map((p) => url('/posts/' + p.slug, p.lastmod, img(p.cover_url))).join('');
    const catXml = catRows.map((c) => url(homeUrl({ category: c.name }), c.lastmod)).join('');
    const tagXml = tagRows.map((t) => url(homeUrl({ tag: t.name }), t.lastmod)).join('');
    const groupXml = groupRows.map((g) => url('/groups/' + g.slug, g.lastmod)).join('');
    const voteXml = voteRows.map((v) => url('/votes/' + v.id, v.lastmod)).join('');
    const courtXml = courtRows.map((c) => url('/court/' + c.id, c.lastmod)).join('');
  const petXml = petRows.map((p) => url('/petitions/' + p.id, p.lastmod)).join('');
  const feedXml = feedRows.map((f) => url('/feed/' + f.id, f.lastmod, f.image_id ? `\n    <image:image><image:loc>${baseUrl}/img/${f.image_id}</image:loc></image:image>` : '')).join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${staticXml}${postsXml}${catXml}${tagXml}${groupXml}${voteXml}${courtXml}${petXml}${feedXml}
</urlset>`;

    res.set('Cache-Control', 'public, max-age=300');
    res.type('application/xml').send(xml);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// ---------- ROBOTS.TXT ----------
// Private / kaam ke pages crawl se bahar; /img aur /feed/ID khule (Google Images + posts ke liye)
router.get('/robots.txt', (req, res) => {
  const baseUrl = baseUrlOf(req);
  const blocked = [
    '/login', '/signup', '/forgot-password', '/reset-password', '/verify-email', '/resend-verification',
    '/messages', '/inbox', '/notifications', '/settings', '/dashboard', '/bookmarks', '/analytics', '/admin',
    '/friends', '/push', '/stories', '/upload-', '/auth', '/report', '/unsubscribe', '/r/',
    '/groups/join/', '/groups/new', '/votes/new', '/court/new', '/petitions/new', '/posts/new', '/invite', '/offline', '/feed/views',
    '/earnings', '/posts/*/edit', '/groups/*/manage', '/groups/*/chat', '/votes/*/go', '/votes/*/state.json', '/cricket/m/*/score', '/cricket/bar/', '/cricket/m/*/state.json',
  ];
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('text/plain').send(
    `User-agent: *\nAllow: /\n${blocked.map((p) => `Disallow: ${p}`).join('\n')}\n\nSitemap: ${baseUrl}/sitemap.xml\n`
  );
});

// ---------- OPENSEARCH (browser ki address bar se seedha site search) ----------
router.get('/opensearch.xml', (req, res) => {
  const baseUrl = baseUrlOf(req);
  const name = xmlEsc(config.siteName).slice(0, 16);
  res.set('Cache-Control', 'public, max-age=86400');
  res.type('application/opensearchdescription+xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>${name}</ShortName>
  <Description>Search ${xmlEsc(config.siteName)}</Description>
  <InputEncoding>UTF-8</InputEncoding>
  <Url type="text/html" method="get" template="${baseUrl}/blog?q={searchTerms}"/>
</OpenSearchDescription>`);
});

// ---------- LEADERBOARD ----------
router.get('/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.username, COUNT(*)::int AS comment_count
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE NOT c.is_hidden
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
    whatsappUrl: config.whatsappUrl,
    facebookUrl: config.facebookUrl,
    whatsappChannelUrl: config.whatsappChannelUrl,
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
      `SELECT p.id, p.slug, p.title, p.category, p.created_at, u.username
       FROM bookmarks b
       JOIN posts p ON p.id = b.post_id
       JOIN users u ON u.id = p.user_id
       WHERE b.user_id = $1 AND ${LIVE}
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
        (SELECT COUNT(*) FROM users)::int AS users,
        (SELECT COUNT(*) FROM subscribers)::int AS subscribers,
        (SELECT COUNT(*) FROM post_visits WHERE created_at > now() - interval '7 days')::int AS visits7`),
      pool.query(`SELECT p.id, p.slug, p.title, p.excerpt, p.content, p.category, p.views, p.is_draft, p.publish_at,
        (p.is_draft = false AND p.publish_at > now()) AS is_scheduled,
        (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id)::int AS likes,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id)::int AS comments
        FROM posts p ORDER BY p.publish_at DESC`),
    ]);
    const posts = list.rows.map((p) => ({ ...p, preview: makePreview(p) }));
    res.render('dashboard', {
      title: 'Dashboard',
      stats: stats.rows[0],
      posts,
      baseUrl: baseUrlOf(req),
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// ---------- NEW POST (admin) ----------
const editorDefaults = { status: 'publish', send_newsletter: true };

router.get('/posts/new', requireAdmin, async (req, res) => {
  res.render('editor', {
    title: 'Write a Post',
    heading: 'Write a New Post',
    action: '/posts',
    error: null,
    categories: await getCategories(),
      polls: await getPollsForSelect(),
    form: { ...editorDefaults },
    isEdit: false,
    tz: TZ,
  });
});

const formFromBody = (body) => ({
  ...body,
  status: body.status === 'draft' ? 'draft' : 'publish',
  send_newsletter: body.send_newsletter === 'on',
});

router.post('/posts', requireAdmin, async (req, res) => {
  const { error, data } = validatePost(req.body, await getCategories());
  if (error) {
    return res.render('editor', {
      title: 'Write a Post',
      heading: 'Write a New Post',
      action: '/posts',
      error,
      categories: await getCategories(),
      polls: await getPollsForSelect(),
      form: formFromBody(req.body),
      isEdit: false,
      tz: TZ,
    });
  }

  try {
    // Slug: admin ne likha ho to wahi (saaf karke), warna title se
    const slug = await uniqueSlug(pool, data.slug || data.title);
    const result = await pool.query(
      `INSERT INTO posts (user_id, title, excerpt, content, category, cover_url,
                          is_draft, publish_at, newsletter_sent, slug)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
               COALESCE($8::timestamp AT TIME ZONE $9::text, now()), $10, $11)
       RETURNING id`,
      [
        req.session.user.id, data.title, data.excerpt, data.content, data.category, data.cover_url,
        data.is_draft, data.publish_at, TZ,
        !data.send_newsletter, // newsletter_sent=true matlab "email mat bhejo"
        slug,
      ]
    );
    await saveTagsForPost(result.rows[0].id, parseTags(req.body.tags));
    await savePostPoll(result.rows[0].id, req.body.poll_id);
    res.redirect('/posts/' + slug);
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
    const result = await pool.query(
      `SELECT p.*,
              to_char(p.publish_at AT TIME ZONE $2::text, 'YYYY-MM-DD"T"HH24:MI') AS publish_at_local
       FROM posts p WHERE p.id = $1`,
      [id, TZ]
    );
    const post = result.rows[0];
    if (!post) return res.status(404).render('404', { title: 'Not Found' });

    const tagsResult = await pool.query(
      `SELECT t.name FROM tags t JOIN post_tags pt ON pt.tag_id = t.id
       WHERE pt.post_id = $1 ORDER BY t.name`,
      [id]
    );
    post.tags = tagsResult.rows.map((r) => r.name).join(', ');
    post.status = post.is_draft ? 'draft' : 'publish';
    post.publish_at = post.is_draft ? '' : post.publish_at_local; // draft ki date khali (publish par abhi ki date lagegi)
    post.send_newsletter = !post.newsletter_sent;

    res.render('editor', {
      title: 'Edit Post',
      heading: 'Edit Post',
      action: `/posts/${id}/edit`,
      error: null,
      categories: await getCategories(),
      polls: await getPollsForSelect(),
      form: post,
      isEdit: true,
      newsletterAlreadySent: post.newsletter_sent,
      tz: TZ,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

router.post('/posts/:id/edit', requireAdmin, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(404).render('404', { title: 'Not Found' });

  const { error, data } = validatePost(req.body, await getCategories());
  if (error) {
    return res.render('editor', {
      title: 'Edit Post',
      heading: 'Edit Post',
      action: `/posts/${id}/edit`,
      error,
      categories: await getCategories(),
      polls: await getPollsForSelect(),
      form: formFromBody(req.body),
      isEdit: true,
      tz: TZ,
    });
  }

  try {
    const cur = await pool.query('SELECT slug FROM posts WHERE id = $1', [id]);
    if (!cur.rows[0]) return res.status(404).render('404', { title: 'Not Found' });
    // Edit par slug wahi rehta hai (purane links na tootein). Sirf tab badalta hai jab admin field khud badle.
    let slug = cur.rows[0].slug;
    if (data.slug && data.slug !== slug) slug = await uniqueSlug(pool, data.slug, id);

    await pool.query(
      `UPDATE posts
       SET slug = $11, title = $1, excerpt = $2, content = $3, category = $4, cover_url = $5,
           updated_at = now(),
           publish_at = CASE
             WHEN $7::text IS NOT NULL THEN ($7::text)::timestamp AT TIME ZONE $8::text
             WHEN posts.is_draft AND NOT $6::boolean THEN now()  -- draft se publish: abhi ki date
             ELSE posts.publish_at END,
           is_draft = $6::boolean,
           newsletter_sent = CASE WHEN posts.newsletter_sent THEN true ELSE NOT $9::boolean END
       WHERE id = $10`,
      [data.title, data.excerpt, data.content, data.category, data.cover_url,
       data.is_draft, data.publish_at, TZ, data.send_newsletter, id, slug]
    );
    await saveTagsForPost(id, parseTags(req.body.tags));
    await savePostPoll(id, req.body.poll_id);

    // Live post edit hui to Bing/Yandex ko batao (await nahi: redirect slow na ho).
    // Nayi publish hui post ko scheduler (lib/publisher.js) bhejta hai.
    const live = await pool.query(`SELECT 1 FROM posts p WHERE p.id = $1 AND ${LIVE}`, [id]);
    if (live.rows[0] && config.siteUrl) {
      indexnow.ping([`${config.siteUrl}/posts/${slug}`], { throttle: true }).catch(() => {});
    }

    res.redirect('/posts/' + slug);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// ---------- SINGLE POST ----------
router.get('/posts/:ref', async (req, res) => {
  // :ref slug hai (/posts/my-post) ya purana number (/posts/12, jo slug par redirect hota hai)
  const ref = String(req.params.ref || '').toLowerCase();
  const byId = /^\d+$/.test(ref);
  if ((byId && ref.length > 9) || (!byId && !/^[a-z0-9-]{1,120}$/.test(ref))) {
    return res.status(404).render('404', { title: 'Not Found' });
  }

  const uid = req.session.user ? req.session.user.id : null;

  try {
    const result = await pool.query(
      `SELECT p.*, u.username,
              (p.is_draft = false AND p.publish_at <= now()) AS is_live,
              (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id)::int AS like_count,
              EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = $2::int) AS liked,
              EXISTS (SELECT 1 FROM bookmarks b WHERE b.post_id = p.id AND b.user_id = $2::int) AS bookmarked,
              EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $2::int AND f.followee_id = p.user_id) AS following
       FROM posts p JOIN users u ON u.id = p.user_id
       WHERE ${byId ? 'p.id = $1::int' : 'p.slug = $1::text'}`,
      [ref, uid]
    );
    const post = result.rows[0];
    // Draft / scheduled post sirf admin dekh sakta hai
    if (!post || (!post.is_live && !res.locals.isAdmin)) {
      return res.status(404).render('404', { title: 'Not Found' });
    }
    const id = post.id;

    // Purana /posts/12 link: permanent redirect naye slug URL par (query string, jaise utm, saath rehti hai)
    if (byId && post.slug) {
      const i = req.originalUrl.indexOf('?');
      return res.redirect(301, '/posts/' + post.slug + (i === -1 ? '' : req.originalUrl.slice(i)));
    }

    // Views aur traffic-source sirf live posts par, aur admin ke nahi
    if (post.is_live && !res.locals.isAdmin && !isBot(req)) {
      await pool.query('UPDATE posts SET views = views + 1 WHERE id = $1', [id]);
      post.views += 1;
      trackVisit(req, res, id); // await nahi: page slow na ho
    }

    // Parhne ka inaam: login user, live post, admin nahi. Server yahan se waqt ginna shuru karta hai.
    // state: null = widget nahi, 'earn' = timer chalega, 'done' = is post ka inaam pehle mil chuka
    let readReward = null;
    try {
      if (config.earnEnabled && post.is_live && uid && !res.locals.isAdmin && !isBot(req)) {
        if (await earnings.readState(uid, id)) readReward = { state: 'done' };
        else {
          earnings.startRead(req, id);
          readReward = { state: 'earn', seconds: config.earnReadSeconds, amount: earnings.rs(config.earnReadPaisa) };
        }
      }
    } catch (err) {
      console.error('[earn read start] (migration_v30.sql chali?):', err.message);
    }

    const [related, comments, tagsResult, reactionResult, myReactionResult] = await Promise.all([
      // Related: pehle wo jin ke tags match karte hain, phir same category
      pool.query(
        `SELECT * FROM (
           SELECT p.id, p.slug, p.title, p.cover_url, p.category, p.publish_at AS created_at,
                  (SELECT COUNT(*) FROM post_tags a JOIN post_tags b ON a.tag_id = b.tag_id
                   WHERE a.post_id = p.id AND b.post_id = $2)::int AS shared_tags
           FROM posts p
           WHERE p.id <> $2 AND ${LIVE}
         ) x
         WHERE x.shared_tags > 0 OR x.category = $1
         ORDER BY x.shared_tags DESC, (x.category = $1) DESC, x.created_at DESC
         LIMIT 4`,
        [post.category, post.id]
      ),
      pool.query(
        `SELECT c.id, c.body, c.created_at, c.user_id, c.parent_id, c.is_hidden, u.username
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

    // Comments ko top-level + replies mein baantna
    const byParent = {};
    const topLevel = [];
    comments.rows.forEach((c) => {
      if (c.parent_id) (byParent[c.parent_id] = byParent[c.parent_id] || []).push(c);
      else topLevel.push(c);
    });
    const threads = topLevel.map((c) => ({ ...c, replies: byParent[c.id] || [] }));

    const base = baseUrlOf(req);
    const shareUrl = `${base}/posts/${post.slug}`;
    const withUtm = (src, medium = 'share') => `${shareUrl}?utm_source=${src}&utm_medium=${medium}`;
    const description = post.excerpt || makePreview(post);
    const tagNames = tagsResult.rows.map((r) => r.name);

    // Share image: cover ho to wahi; na ho to title wala auto card (OG_CARD_ALWAYS=true se hamesha card)
    const cover = absUrl(base, post.cover_url);
    const useCard = card.isAvailable() && (!cover || process.env.OG_CARD_ALWAYS === 'true');
    const ogImage = useCard ? `${base}/og/${post.slug}.png` : (cover || config.defaultOgImage || null);

    // Post ke andar vote widget (agar admin ne contest lagaya ho)
    let pollState = null;
    let pollNotice = null;
    if (post.poll_id) {
      try {
        pollNotice = await polls.applyPending(req, post.poll_id); // login se pehle dabaya hua vote
        pollState = await polls.loadState(post.poll_id, uid, base);
        if (pollState && post.is_live && !res.locals.isAdmin) polls.trackView(req, res, post.poll_id, 'post');
      } catch (err) {
        console.error('[post poll]', err.message);
      }
    }

    const { html: contentHtml, toc } = addToc(renderMarkdown(post.content));

    res.render('post', {
      title: post.title,
      metaDescription: description,
      ogImage,
      ogImageCard: useCard,
      ogUrl: shareUrl,
      ogType: 'article',
      jsonLd: post.is_live
        ? postLd({
            base, siteName: config.siteName, post, description, image: ogImage, tags: tagNames, content: post.content,
            logo: card.isAvailable() ? base + '/icons/512.png' : null,
          })
        : [],
      publishedTime: new Date(post.publish_at).toISOString(),
      modifiedTime: new Date(post.updated_at || post.publish_at).toISOString(),
      articleSection: post.category,
      articleTags: tagNames,
      ogImageAlt: post.title,
      robots: post.is_live ? null : 'noindex,nofollow',
      post,
      readReward,
      contentHtml,
      toc,
      related: related.rows,
      comments: comments.rows,
      threads,
      tags: tagNames,
      reactionEmojis: REACTION_EMOJIS,
      reactionCounts,
      myReaction,
      shareUrl,
      shareLinks: {
        whatsapp: withUtm('whatsapp'),
        facebook: withUtm('facebook'),
        twitter: withUtm('twitter'),
        copy: withUtm('link'),
      },
      pollState,
      pollNotice,
      readingTime: readingTimeOf(post.content),
      tz: TZ,
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

// ---------- COMMENTS (replies + notifications) ----------
router.post('/posts/:id/comments', requireLogin, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.redirect('/');

  const body = (req.body.body || '').trim();
  if (!body || body.length > 1000) {
    const msg = encodeURIComponent('Comment must be between 1 and 1000 characters.');
    return res.redirect(`/posts/${id}?commentError=${msg}#comments`);
  }

  const me = req.session.user;
  const replyToId = toId(req.body.parent_id);

  try {
    const postRes = await pool.query(
      `SELECT p.id, p.slug, p.title, p.user_id FROM posts p WHERE p.id = $1 AND (${LIVE} OR $2::boolean)`,
      [id, res.locals.isAdmin]
    );
    const post = postRes.rows[0];
    if (!post) return res.redirect('/');

    // Reply hai? Jis comment ka jawab hai wo isi post ka hona chahiye.
    // Sirf 1 level nesting: reply ka reply bhi top-level comment ke neeche lagta hai.
    let parentId = null;
    let repliedTo = null;
    if (replyToId) {
      const pr = await pool.query(
        'SELECT id, user_id, parent_id FROM comments WHERE id = $1 AND post_id = $2',
        [replyToId, id]
      );
      repliedTo = pr.rows[0] || null;
      if (repliedTo) parentId = repliedTo.parent_id || repliedTo.id;
    }

    // Spam filter: block = save nahi hota, hold = hidden save + moderation queue
    const verdict = await spam.check(body, { userId: me.id, isAdmin: res.locals.isAdmin });
    if (verdict.action === 'block') {
      return res.redirect(`/posts/${post.slug}?commentError=${encodeURIComponent(verdict.message)}#comments`);
    }
    const held = verdict.action === 'hold';

    const ins = await pool.query(
      'INSERT INTO comments (post_id, user_id, body, parent_id, is_hidden) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [id, me.id, body, parentId, held]
    );
    const link = `/posts/${post.slug}#c${ins.rows[0].id}`;
    const short = post.title.length > 60 ? post.title.slice(0, 57) + '...' : post.title;

    if (held) {
      await moderation.holdForReview('comment', ins.rows[0].id, verdict.reason);
      return res.redirect(`/posts/${post.slug}?commentNotice=${encodeURIComponent('Your comment is waiting for review by the site owner. Only you can see it until then.')}#c${ins.rows[0].id}`);
    }

    if (repliedTo && repliedTo.user_id !== me.id) {
      // Jis ne comment kiya tha use in-app notification + email
      notifyUser(repliedTo.user_id, `${me.username} replied to your comment on "${short}"`, link, {
        email: true,
        emailSubject: `${me.username} replied to your comment`,
      });
    }
    if (post.user_id !== me.id && (!repliedTo || repliedTo.user_id !== post.user_id)) {
      // Blog owner ko bhi pata chale ke naya comment aaya
      notifyUser(post.user_id, `${me.username} commented on "${short}"`, link);
    }

    res.redirect(link);
  } catch (err) {
    console.error(err);
    return res.redirect('/');
  }
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