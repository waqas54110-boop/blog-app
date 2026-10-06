// Headlines bar (har page par): jo category select ho, usi ki taaza headlines. Category ki list aur headlines 60 second cache hoti hain.
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

// category '' = sab
const forCategory = (category) => remember('h:' + (category || '*'), async () => {
  const r = category
    ? await pool.query(`SELECT p.slug, p.title FROM posts p WHERE ${LIVE} AND p.category = $1 ORDER BY p.publish_at DESC LIMIT 10`, [category])
    : await pool.query(`SELECT p.slug, p.title FROM posts p WHERE ${LIVE} ORDER BY p.publish_at DESC LIMIT 10`);
  return r.rows;
});

// Cookie "kz_cat": '*' = sab, warna category ka naam. (cookie-parser nahi, is liye haath se)
function cookieCat(req) {
  const m = /(?:^|;\s*)kz_cat=([^;]*)/.exec(req.headers.cookie || '');
  if (!m) return null;
  try { return decodeURIComponent(m[1]).slice(0, 60); } catch (e) { return null; }
}

// Request ke liye bar ka data: pehle cookie wali (user ne khud chuni), warna page ki category (blog category / post), warna sab
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
