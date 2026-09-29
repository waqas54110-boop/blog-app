// Post ke title se URL-friendly slug banata hai (jaise "My First Post!" -> "my-first-post").
const slugify = (input) => {
  let out = String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  if (!out) out = 'post';
  if (/^\d+$/.test(out)) out = 'post-' + out; // sirf number wala slug purane /posts/:id se takra jata
  return out;
};

// Unique slug: agar pehle se hai to -2, -3 ... lagata hai.
async function uniqueSlug(pool, wanted, excludeId = null) {
  const base = slugify(wanted);
  let candidate = base;
  let n = 1;
  for (;;) {
    const r = await pool.query(
      'SELECT 1 FROM posts WHERE slug = $1 AND ($2::int IS NULL OR id <> $2::int)',
      [candidate, excludeId]
    );
    if (r.rowCount === 0) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

module.exports = { slugify, uniqueSlug };
