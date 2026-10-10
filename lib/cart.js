// V56: Cart. Cart session mein rehta hai (bina login ke bhi chalta hai): [{ p: productId, v: variantId | 0, q: qty }]
// Cart kholte waqt har cheez dobara database se check hoti hai (qeemat, stock, product / shop abhi live hai ya nahi).
const pool = require('../db');
const config = require('../config');
const S = require('./shop');

const keyOf = (p, v) => `${p}-${v || 0}`;

function lines(req) {
  const c = req.session && req.session.cart;
  if (!Array.isArray(c)) return [];
  return c.filter((l) => l && Number.isInteger(l.p) && l.p > 0 && Number.isInteger(l.q) && l.q > 0)
    .map((l) => ({ p: l.p, v: Number.isInteger(l.v) && l.v > 0 ? l.v : 0, q: Math.min(l.q, S.MAX_QTY) }));
}
const save = (req, arr) => { req.session.cart = arr.slice(0, config.cartMaxLines); };
const count = (req) => lines(req).reduce((a, l) => a + l.q, 0);
const clear = (req) => { req.session.cart = []; };

// Return: 'ok' | 'full'
function add(req, productId, variantId, qty) {
  const ls = lines(req);
  const k = keyOf(productId, variantId);
  const hit = ls.find((l) => keyOf(l.p, l.v) === k);
  if (hit) hit.q = Math.min(S.MAX_QTY, hit.q + qty);
  else {
    if (ls.length >= config.cartMaxLines) return 'full';
    ls.push({ p: productId, v: variantId || 0, q: Math.min(S.MAX_QTY, qty) });
  }
  save(req, ls);
  return 'ok';
}
function setQty(req, key, qty) {
  const ls = lines(req);
  const next = ls.map((l) => (keyOf(l.p, l.v) === key ? { ...l, q: Math.min(S.MAX_QTY, qty) } : l)).filter((l) => l.q > 0);
  save(req, next);
}
const remove = (req, key) => save(req, lines(req).filter((l) => keyOf(l.p, l.v) !== key));

// Cart ko database se mila kar load karo. Jo cheez ab nahi bik sakti wo hat jati hai (dropped), jis ki quantity zyada ho wo kam (adjusted).
async function load(req) {
  const ls = lines(req);
  if (!ls.length) return { groups: [], count: 0, dropped: [], adjusted: [] };
  const pids = [...new Set(ls.map((l) => l.p))];
  const products = {};
  (await pool.query('SELECT * FROM products WHERE id = ANY($1::int[])', [pids])).rows.forEach((p) => { products[p.id] = p; });
  const shops = {};
  const sids = [...new Set(Object.values(products).map((p) => p.shop_id))];
  if (sids.length) (await pool.query('SELECT * FROM shops WHERE id = ANY($1::int[])', [sids])).rows.forEach((s) => { shops[s.id] = s; });
  const variants = {}; const hasVariants = {};
  (await pool.query('SELECT * FROM product_variants WHERE product_id = ANY($1::int[]) ORDER BY position, id', [pids])).rows.forEach((v) => {
    variants[v.id] = v; hasVariants[v.product_id] = true;
  });
  const imgs = {};
  (await pool.query(
    `SELECT DISTINCT ON (product_id) product_id, image_id FROM product_images WHERE product_id = ANY($1::int[]) ORDER BY product_id, position, image_id`, [pids]))
    .rows.forEach((r) => { imgs[r.product_id] = r.image_id; });

  const kept = []; const dropped = []; const adjusted = []; const out = [];
  for (const l of ls) {
    const p = products[l.p];
    const sh = p && shops[p.shop_id];
    const name = p ? p.name : 'Ek product';
    if (!p || !p.is_active || !sh || sh.status !== 'active') { dropped.push(name); continue; }
    let v = null;
    if (hasVariants[p.id]) {
      v = l.v ? variants[l.v] : null;
      if (!v || v.product_id !== p.id) { dropped.push(name); continue; }
    } else if (l.v) { dropped.push(name); continue; }
    const avail = v ? v.stock : p.stock;
    if (avail <= 0) { dropped.push(name + (v ? ` (${S.variantLabel(v)})` : '')); continue; }
    const q = Math.min(l.q, avail, S.MAX_QTY);
    if (q < l.q) adjusted.push(name + (v ? ` (${S.variantLabel(v)})` : ''));
    const unit = v && v.price_rs != null ? v.price_rs : p.price_rs;
    kept.push({ p: l.p, v: l.v, q });
    out.push({ key: keyOf(l.p, l.v), product: p, variant: v, variantLabel: v ? S.variantLabel(v) : '', shop: sh, qty: q, unit, total: unit * q, avail, image_id: imgs[p.id] || null });
  }
  if (dropped.length || adjusted.length) save(req, kept);

  const groups = [];
  for (const ln of out) {
    let g = groups.find((x) => x.shop.id === ln.shop.id);
    if (!g) { g = { shop: ln.shop, lines: [], subtotal: 0 }; groups.push(g); }
    g.lines.push(ln); g.subtotal += ln.total;
  }
  return { groups, count: out.reduce((a, l) => a + l.qty, 0), dropped, adjusted };
}

// Har shop ke group par coupon / delivery / total laga do. code = customer ne jo likha (khali ho sakta hai).
// Return: cart (groups mein coupon, discount, delivery, total) + grand + couponError
async function price(req, cart, code) {
  let anyFound = false; let firstProblem = null; let applied = false;
  const c = S.cleanCode(code);
  for (const g of cart.groups) {
    g.coupon = null; g.couponProblem = null; g.discount = 0;
    if (c) {
      const row = await S.findCoupon(g.shop.id, c);
      if (row) {
        anyFound = true;
        const sources = new Set(g.lines.map((l) => S.attrFor(req, l.product.id).source));
        const problem = S.couponProblem(row, g.subtotal, sources);
        if (problem) { g.couponProblem = problem; if (!firstProblem) firstProblem = problem; }
        else { g.coupon = row; g.discount = S.couponDiscount(row, g.subtotal); applied = true; }
      }
    }
    g.delivery = S.deliveryFor(g.shop, g.subtotal);
    g.total = g.subtotal - g.discount + g.delivery;
  }
  cart.grand = cart.groups.reduce((a, g) => a + g.total, 0);
  cart.discountTotal = cart.groups.reduce((a, g) => a + g.discount, 0);
  cart.couponCode = c;
  cart.couponApplied = applied;
  cart.couponError = !c ? null : (applied ? null : (firstProblem || (anyFound ? null : 'Ye coupon in products par nahi lagta ya sahi nahi.')));
  return cart;
}

// "Ye bhi khareedein": cart ki shops ke products pehle, phir sab se zyada bikne wale. Cart ki cheezein nahi.
async function suggestions(cart, limit = 4) {
  const inCart = [...new Set(cart.groups.flatMap((g) => g.lines.map((l) => l.product.id)))];
  const shopIds = cart.groups.map((g) => g.shop.id);
  try {
    return (await pool.query(
      `SELECT ${S.CARD_COLS},
              EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id) AS has_variants,
              (SELECT COUNT(*)::int FROM order_items oi WHERE oi.product_id = p.id) AS popularity
       FROM products p JOIN shops s ON s.id = p.shop_id
       WHERE ${S.PUBLIC_WHERE} AND p.stock > 0 AND p.id <> ALL($1::int[])
       ORDER BY (p.shop_id = ANY($2::int[])) DESC, popularity DESC, p.created_at DESC
       LIMIT ${Math.max(1, Math.min(limit, 8))}`, [inCart, shopIds])).rows;
  } catch (err) { console.error('[cart] suggestions:', err.message); return []; }
}

module.exports = { keyOf, lines, count, add, setQty, remove, clear, load, price, suggestions };
