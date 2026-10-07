// Headlines bar (on every page): the latest headlines of the selected category. The category list and the headlines are cached for 60 seconds.
const pool = require('../db');

const LIVE = 'p.is_draft = false AND p.publish_at <= now()';
const TTL = 60 * 1000;
const cache = new Map();   // key -> { t, v }

async function remember(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  if (cache.size > 60) cache.clear();
  return v;
}

const categories = () => remember('cats', async () =>
  (await pool.query(`SELECT p.category FROM posts p WHERE ${LIVE} GROUP BY p.category ORDER BY COUNT(*) DESC, p.category`)).rows.map((r) => r.category));

// category '' = all
const forCategory = (category) => remember('h:' + (category || '*'), async () => {
  const r = category
    ? await pool.query(`SELECT p.slug, p.title FROM posts p WHERE ${LIVE} AND p.category = $1 ORDER BY p.publish_at DESC LIMIT 10`, [category])
    : await pool.query(`SELECT p.slug, p.title FROM posts p WHERE ${LIVE} ORDER BY p.publish_at DESC LIMIT 10`);
  return r.rows;
});

// Cookie "kz_cat": '*' = all, otherwise the category name. (There is no cookie-parser, so it is parsed by hand.)
function cookieCat(req) {
  const m = /(?:^|;\s*)kz_cat=([^;]*)/.exec(req.headers.cookie || '');
  if (!m) return null;
  try { return decodeURIComponent(m[1]).slice(0, 60); } catch (e) { return null; }
}

// Bar data for a request: first the cookie category (the user's own choice), otherwise the page's category (blog category / post), otherwise all
async function forRequest(req) {
  const cats = await categories();
  let chosen = cookieCat(req);
  let cat = '';
  if (chosen === '*') cat = '';
  else if (chosen && cats.includes(chosen)) cat = chosen;
  else {
    chosen = null;
    if (req.path === '/blog' && cats.includes(String(req.query.category || ''))) cat = String(req.query.category);
    else if (req.path.startsWith('/posts/')) {
      const slug = decodeURIComponent(req.path.slice(7).split('/')[0] || '');
      const r = slug ? await pool.query('SELECT category FROM posts WHERE slug = $1', [slug]) : { rows: [] };
      if (r.rows[0] && cats.includes(r.rows[0].category)) cat = r.rows[0].category;
    }
  }
  return { cat, cats, items: await forCategory(cat) };
}

module.exports = { categories, forCategory, forRequest };
