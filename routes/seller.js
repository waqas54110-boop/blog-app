// Shop (V46) seller panel: /seller (dashboard), /seller/open + /seller/settings, products, orders (status),
// /seller/share (group-wise UTM links, like Group Poster), /seller/analytics (group-wise sales), /admin/shops.
const crypto = require('crypto');
const express = require('express');
const pool = require('../db');
const config = require('../config');
const S = require('../lib/shop');
const { maskIp, countryName, flag } = require('../lib/demographics');
const { uaLabel } = require('../lib/analytics');
const Restricted = require('../lib/restricted');
const Images = require('../lib/images');
const { slugify } = require('../lib/slug');
const { cleanLink } = require('../lib/ads');
const { notifyUser } = require('../lib/notify');
const WA = require('../lib/whatsapp');
const couriers = require('../lib/couriers');

const router = express.Router();
const TZ = config.timezone;
const MAX_GROUPS = 300;
const MAX_VARIANTS = 30;
const MAX_COUPONS = 100;

const flashOf = (req) => ({
  msg: req.query.msg ? String(req.query.msg).slice(0, 200) : null,
  error: req.query.error ? String(req.query.error).slice(0, 200) : null,
});
const go = (res, path, msg, key = 'msg') => res.redirect(path + (msg ? (path.includes('?') ? '&' : '?') + key + '=' + encodeURIComponent(msg) : ''));
const dbError = (res, err) => {
  if (err && (err.code === '42P01' || err.code === '42703')) {
    return res.status(503).render('404', { code: 503, title: 'Shop setup', message: 'The shop is still being set up (migration_v46.sql). Please try again in a little while.' });
  }
  console.error(err);
  return res.status(500).send('Server error');
};
const deny = (res, message) => res.status(403).render('404', { code: 403, title: 'Not allowed', message });

const requireLogin = (req, res, next) => {
  if (!req.session.user) { req.session.returnTo = req.originalUrl; return res.redirect('/login'); }
  next();
};
const requireAdmin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') return deny(res, 'Only the site owner can do this.');
  next();
};
// Load the seller's own shop (if none, go to the open-shop page)
const requireShop = async (req, res, next) => {
  try {
    const shop = await S.getMyShop(req.session.user.id);
    if (!shop) return res.redirect('/seller/open');
    req.shop = shop;
    res.locals.shop = shop;
    next();
  } catch (err) { dbError(res, err); }
};
const guard = [requireLogin, requireShop];

const render = (res, view, data) => res.status(data.code || 200).render(view, { robots: 'noindex,nofollow', rs: S.rs, showPhone: S.showPhone, ...data });

// ============================================================
// OPEN / SETTINGS
// ============================================================
const shopForm = (s) => ({
  name: s.name || '', tagline: s.tagline || '', description: s.description || '', city: s.city || '',
  whatsapp: s.whatsapp ? S.showPhone(s.whatsapp) : '', phone: s.phone ? S.showPhone(s.phone) : '',
  cod: s.cod_enabled !== false, wa: s.wa_enabled !== false,
  delivery_fee: String(s.delivery_fee_rs || 0), free_over: s.free_over_rs ? String(s.free_over_rs) : '',
  logo: s.logo_image_id ? String(s.logo_image_id) : '',
});

function readShopForm(b) {
  return {
    name: S.oneLine(b.name, 80), tagline: S.oneLine(b.tagline, 140), description: S.multiLine(b.description, 1500),
    city: S.oneLine(b.city, 60), whatsapp: S.oneLine(b.whatsapp, 20), phone: S.oneLine(b.phone, 20),
    cod: b.cod === '1', wa: b.wa === '1',
    delivery_fee: S.oneLine(b.delivery_fee, 8), free_over: S.oneLine(b.free_over, 8),
    logo: S.toId(b.logo_ids) ? String(S.toId(b.logo_ids)) : '',
  };
}
async function checkShopForm(f) {
  if (await Restricted.find([f.name, f.tagline, f.description].join('\n'))) return { error: Restricted.MSG_UR };
  if (f.name.length < 3) return { error: 'Enter a shop name (at least 3 characters).' };
  if (f.city.length < 2) return { error: 'Enter the city name.' };
  const wa = S.cleanPhone(f.whatsapp);
  if (!wa) return { error: 'Enter your WhatsApp number, e.g. 0300 1234567. Order alerts are sent to it.' };
  const ph = S.cleanPhone(f.phone);
  if (ph === null) return { error: 'Phone number is not valid. Use a format like 0300 1234567 (or leave it empty).' };
  if (!f.cod && !f.wa) return { error: 'Keep at least one method on: Cash on Delivery or WhatsApp order.' };
  const fee = f.delivery_fee === '' ? 0 : S.toRs(f.delivery_fee);
  if (fee === null || fee > 100000) return { error: 'Enter valid delivery charges (numbers only, e.g. 200).' };
  const free = f.free_over === '' ? null : S.toRs(f.free_over);
  if (f.free_over !== '' && (free === null || free > 10000000)) return { error: 'Enter a valid "Free delivery over" amount (numbers only) or leave it empty.' };
  return { wa, ph: ph || null, fee, free };
}

router.get('/seller/open', requireLogin, async (req, res) => {
  try {
    if (await S.getMyShop(req.session.user.id)) return res.redirect('/seller');
    if (config.shopAdminOnly && req.session.user.role !== 'admin') return deny(res, 'For now, only the site owner can create new shops.');
    render(res, 'seller-open', { title: 'Open your shop', f: shopForm({}), error: null, edit: false, approval: config.shopApproval && req.session.user.role !== 'admin' });
  } catch (err) { dbError(res, err); }
});

router.post('/seller/open', requireLogin, async (req, res) => {
  try {
    const me = req.session.user;
    if (await S.getMyShop(me.id)) return res.redirect('/seller');
    if (config.shopAdminOnly && me.role !== 'admin') return deny(res, 'For now, only the site owner can create new shops.');
    const f = readShopForm(req.body || {});
    const c = await checkShopForm(f);
    const fail = (m) => render(res, 'seller-open', { title: 'Open your shop', code: 400, f, error: m, edit: false, approval: config.shopApproval && me.role !== 'admin' });
    if (c.error) return fail(c.error);
    if (f.logo && !(await S.usableImage(parseInt(f.logo, 10), me.id, null))) f.logo = '';
    const slug = await S.uniqueShopSlug(f.name);
    const status = config.shopApproval && me.role !== 'admin' ? 'pending' : 'active';
    await pool.query(
      `INSERT INTO shops (owner_id, slug, name, tagline, description, city, whatsapp, phone, logo_image_id, cod_enabled, wa_enabled, delivery_fee_rs, free_over_rs, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [me.id, slug, f.name, f.tagline || null, f.description || null, f.city, c.wa, c.ph, f.logo ? parseInt(f.logo, 10) : null, f.cod, f.wa, c.fee, c.free, status]);
    go(res, '/seller/products/new', status === 'pending' ? 'Your shop is created! It will go public after the site owner approves it. You can add products in the meantime.' : 'Your shop is created! Now add your first product.');
  } catch (err) { dbError(res, err); }
});

router.get('/seller/settings', guard, (req, res) => {
  render(res, 'seller-open', { title: 'Shop settings', f: shopForm(req.shop), error: null, edit: true, ...flashOf(req), approval: false, seller: 'settings' });
});

router.post('/seller/settings', guard, async (req, res) => {
  try {
    const me = req.session.user;
    const f = readShopForm(req.body || {});
    const c = await checkShopForm(f);
    const fail = (m) => render(res, 'seller-open', { title: 'Shop settings', code: 400, f, error: m, edit: true, approval: false, seller: 'settings' });
    if (c.error) return fail(c.error);
    const oldLogo = req.shop.logo_image_id;
    let logo = f.logo ? parseInt(f.logo, 10) : null;
    if (logo && logo !== oldLogo && !(await S.usableImage(logo, me.id, null))) logo = oldLogo;
    let slug = req.shop.slug;
    if (f.name !== req.shop.name && req.body.rename_link === '1') slug = await S.uniqueShopSlug(f.name, req.shop.id);
    await pool.query(
      `UPDATE shops SET slug=$2, name=$3, tagline=$4, description=$5, city=$6, whatsapp=$7, phone=$8, logo_image_id=$9,
         cod_enabled=$10, wa_enabled=$11, delivery_fee_rs=$12, free_over_rs=$13 WHERE id=$1`,
      [req.shop.id, slug, f.name, f.tagline || null, f.description || null, f.city, c.wa, c.ph, logo, f.cod, f.wa, c.fee, c.free]);
    if (oldLogo && oldLogo !== logo) await Images.dropIfOrphan(oldLogo, null).catch(() => {});
    go(res, '/seller/settings', 'Settings saved.');
  } catch (err) { dbError(res, err); }
});

// ============================================================
// DASHBOARD
// ============================================================
router.get('/seller', requireLogin, async (req, res) => {
  try {
    const shop = await S.getMyShop(req.session.user.id);
    if (!shop) return res.redirect('/seller/open');
    const st = (await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM orders WHERE shop_id = $1 AND status = 'new') AS new_orders,
         (SELECT COUNT(*)::int FROM orders WHERE shop_id = $1 AND status = 'shipped') AS shipped,
         (SELECT COUNT(*)::int FROM orders WHERE shop_id = $1 AND created_at >= (now() AT TIME ZONE $2::text)::date AT TIME ZONE $2::text) AS today,
         (SELECT COALESCE(SUM(total_rs), 0)::int FROM orders WHERE shop_id = $1 AND status = 'delivered') AS delivered_rs,
         (SELECT COALESCE(SUM(total_rs), 0)::int FROM orders WHERE shop_id = $1 AND status IN ('new','shipped')) AS pending_rs,
         (SELECT COUNT(*)::int FROM products WHERE shop_id = $1) AS products,
         (SELECT COUNT(*)::int FROM products WHERE shop_id = $1 AND stock = 0) AS sold_out,
         (SELECT COUNT(*)::int FROM products WHERE shop_id = $1 AND stock BETWEEN 1 AND 5) AS low`, [shop.id, TZ])).rows[0];
    const recent = (await pool.query(
      `SELECT id, product_name, qty, total_rs, customer_name, city, status, created_at FROM orders WHERE shop_id = $1 ORDER BY id DESC LIMIT 6`, [shop.id])).rows;
    res.locals.shop = shop;
    render(res, 'seller', { title: 'My Shop', shop, st, recent, STATUS_LABEL: S.STATUS_LABEL, STATUS_COLOR: S.STATUS_COLOR, seller: 'home', ...flashOf(req) });
  } catch (err) { dbError(res, err); }
});

// ============================================================
// PRODUCTS
// ============================================================
const blankProduct = () => ({ name: '', category: '', description: '', price: '', compare: '', stock: '10', active: true, images: [], variants: [] });
const productFormOf = (p, images, variants = []) => ({
  name: p.name, category: p.category || '', description: p.description || '', price: String(p.price_rs),
  compare: p.compare_price_rs ? String(p.compare_price_rs) : '', stock: String(p.stock), active: p.is_active, images,
  variants: variants.map((v) => ({ id: v.id, color: v.color || '', size: v.size || '', kind: v.kind || '', price: v.price_rs != null ? String(v.price_rs) : '', stock: String(v.stock) })),
});
// Variant rows from the form: v_id[], v_color[], v_size[], v_kind[], v_price[], v_stock[]. Completely empty rows are skipped.
function readVariants(b) {
  const A = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
  const id = A(b.v_id); const color = A(b.v_color); const size = A(b.v_size); const kind = A(b.v_kind);
  const price = A(b.v_price); const stock = A(b.v_stock);
  const n = Math.min(Math.max(color.length, size.length, kind.length, stock.length), MAX_VARIANTS + 10);
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({ id: S.toId(id[i]), color: S.oneLine(color[i], 30), size: S.oneLine(size[i], 30), kind: S.oneLine(kind[i], 30), price: S.oneLine(price[i], 10), stock: S.oneLine(stock[i], 7) });
  }
  return rows.filter((r) => r.color || r.size || r.kind);
}
function readProductForm(b) {
  const ids = String(b.image_ids || '').split(',').map((x) => S.toId(x.trim())).filter(Boolean);
  return {
    name: S.oneLine(b.name, 120), category: S.CATEGORIES.includes(b.category) ? b.category : '',
    description: S.multiLine(b.description, 3000),
    price: S.oneLine(b.price_rs, 10), compare: S.oneLine(b.compare_price_rs, 10), stock: S.oneLine(b.stock, 7),
    active: b.is_active === '1', images: [...new Set(ids)].slice(0, S.MAX_PRODUCT_PHOTOS),
    variants: readVariants(b),
  };
}
async function checkProductForm(f) {
  if (await Restricted.find([f.name, f.description, f.category, ...f.variants.map((v) => S.variantLabel(v))].join('\n'))) return { error: Restricted.MSG_UR };
  if (f.name.length < 3) return { error: 'Enter a product name (at least 3 characters).' };
  const price = S.toRs(f.price);
  if (!price || price > 9999999) return { error: 'Enter a valid price (numbers only, e.g. 1500).' };
  let compare = null;
  if (f.compare !== '') {
    compare = S.toRs(f.compare);
    if (!compare || compare > 9999999) return { error: 'Enter a valid old price or leave it empty.' };
    if (compare <= price) compare = null; // the old price is shown only if it is higher than the new one
  }
  // Variants (color / size / type): each has its own stock and (optionally) its own price
  if (f.variants.length > MAX_VARIANTS) return { error: `A product cannot have more than ${MAX_VARIANTS} variants.` };
  const variants = [];
  const seen = new Set();
  for (const r of f.variants) {
    const label = S.variantLabel(r);
    if (seen.has(label.toLowerCase())) return { error: `Variant "${label}" is entered twice.` };
    seen.add(label.toLowerCase());
    const vs = r.stock === '' ? 0 : S.toRs(r.stock);
    if (vs === null || vs > 99999) return { error: `Enter a valid stock for variant "${label}" (0 to 99999).` };
    let vp = null;
    if (r.price !== '') {
      vp = S.toRs(r.price);
      if (!vp || vp > 9999999) return { error: `Enter a valid price for variant "${label}" or leave it empty.` };
    }
    variants.push({ id: r.id, color: r.color || null, size: r.size || null, kind: r.kind || null, price: vp, stock: vs });
  }
  let stock;
  if (variants.length) {
    stock = variants.reduce((a, v) => a + v.stock, 0); // a product with variants has stock = sum of its variants
  } else {
    stock = f.stock === '' ? 0 : S.toRs(f.stock);
    if (stock === null || stock > 99999) return { error: 'Enter a valid stock (0 to 99999).' };
  }
  return { price, compare, stock, variants };
}
const renderProductForm = (res, req, { code = 200, f, error = null, edit = null }) =>
  render(res, 'seller-product-form', { code, title: edit ? 'Edit product' : 'New product', f, error, edit, CATEGORIES: S.CATEGORIES, MAX_PHOTOS: S.MAX_PRODUCT_PHOTOS, seller: 'products' });

// Product photos: save per the list; removed photos are cleaned up if not used elsewhere
async function saveProductImages(productId, userId, ids) {
  const keep = [];
  for (const id of ids) { if (await S.usableImage(id, userId, productId)) keep.push(id); }
  const old = (await pool.query('SELECT image_id FROM product_images WHERE product_id = $1', [productId])).rows.map((r) => r.image_id);
  await pool.query('DELETE FROM product_images WHERE product_id = $1 AND NOT (image_id = ANY($2::int[]))', [productId, keep]);
  for (let i = 0; i < keep.length; i++) {
    await pool.query(
      `INSERT INTO product_images (product_id, image_id, position) VALUES ($1, $2, $3)
       ON CONFLICT (product_id, image_id) DO UPDATE SET position = EXCLUDED.position`, [productId, keep[i], i]);
  }
  for (const id of old.filter((x) => !keep.includes(x))) await Images.dropIfOrphan(id, null).catch(() => {});
}

// Save variants: update those whose id belongs to this product, insert new ones, delete the rest (old orders keep their saved name / price)
async function saveVariants(productId, variants) {
  const have = (await pool.query('SELECT id FROM product_variants WHERE product_id = $1', [productId])).rows.map((r) => r.id);
  const keep = [];
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    if (v.id && have.includes(v.id)) {
      await pool.query('UPDATE product_variants SET color=$2, size=$3, kind=$4, price_rs=$5, stock=$6, position=$7 WHERE id=$1 AND product_id=$8',
        [v.id, v.color, v.size, v.kind, v.price, v.stock, i, productId]);
      keep.push(v.id);
    } else {
      const r = await pool.query('INSERT INTO product_variants (product_id, color, size, kind, price_rs, stock, position) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [productId, v.color, v.size, v.kind, v.price, v.stock, i]);
      keep.push(r.rows[0].id);
    }
  }
  await pool.query('DELETE FROM product_variants WHERE product_id = $1 AND NOT (id = ANY($2::int[]))', [productId, keep]);
  if (keep.length) {
    await pool.query('UPDATE products SET stock = (SELECT COALESCE(SUM(stock), 0) FROM product_variants WHERE product_id = $1), updated_at = now() WHERE id = $1', [productId]);
  }
}

router.get('/seller/products', guard, async (req, res) => {
  try {
    const items = (await pool.query(
      `SELECT p.id, p.slug, p.name, p.price_rs, p.compare_price_rs, p.stock, p.is_active, ${S.MAIN_IMG} AS image_id,
              (SELECT COALESCE(SUM(oi.qty), 0)::int FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id AND o.status <> 'returned') AS sold,
              (SELECT COUNT(*)::int FROM product_variants v WHERE v.product_id = p.id) AS variant_count
       FROM products p WHERE p.shop_id = $1 ORDER BY p.created_at DESC`, [req.shop.id])).rows;
    render(res, 'seller-products', { title: 'My products', items, seller: 'products', ...flashOf(req) });
  } catch (err) { dbError(res, err); }
});

router.get('/seller/products/new', guard, (req, res) => renderProductForm(res, req, { f: blankProduct() }));

router.post('/seller/products', guard, async (req, res) => {
  try {
    const f = readProductForm(req.body || {});
    const c = await checkProductForm(f);
    if (c.error) return renderProductForm(res, req, { code: 400, f, error: c.error });
    const n = (await pool.query('SELECT COUNT(*)::int AS n FROM products WHERE shop_id = $1', [req.shop.id])).rows[0].n;
    if (n >= config.shopMaxProducts) return renderProductForm(res, req, { code: 400, f, error: `A shop can have up to ${config.shopMaxProducts} products.` });
    const slug = await S.uniqueProductSlug(req.shop.id, f.name);
    const ins = await pool.query(
      `INSERT INTO products (shop_id, slug, name, category, description, price_rs, compare_price_rs, stock, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [req.shop.id, slug, f.name, f.category || null, f.description || null, c.price, c.compare, c.stock, f.active]);
    await saveProductImages(ins.rows[0].id, req.session.user.id, f.images);
    await saveVariants(ins.rows[0].id, c.variants);
    go(res, '/seller/products', 'Product added.');
  } catch (err) { dbError(res, err); }
});

const ownProduct = async (shopId, id) => {
  const pid = S.toId(id);
  if (!pid) return null;
  return (await pool.query('SELECT * FROM products WHERE id = $1 AND shop_id = $2', [pid, shopId])).rows[0] || null;
};

router.get('/seller/products/:id/edit', guard, async (req, res) => {
  try {
    const p = await ownProduct(req.shop.id, req.params.id);
    if (!p) return go(res, '/seller/products', 'Product not found.', 'error');
    const imgs = (await pool.query('SELECT image_id FROM product_images WHERE product_id = $1 ORDER BY position, image_id', [p.id])).rows.map((r) => r.image_id);
    renderProductForm(res, req, { f: productFormOf(p, imgs, await S.variantsOf(p.id)), edit: p });
  } catch (err) { dbError(res, err); }
});

router.post('/seller/products/:id', guard, async (req, res) => {
  try {
    const p = await ownProduct(req.shop.id, req.params.id);
    if (!p) return go(res, '/seller/products', 'Product not found.', 'error');
    const f = readProductForm(req.body || {});
    const c = await checkProductForm(f);
    if (c.error) return renderProductForm(res, req, { code: 400, f, error: c.error, edit: p });
    await pool.query(
      `UPDATE products SET name=$2, category=$3, description=$4, price_rs=$5, compare_price_rs=$6, stock=$7, is_active=$8, updated_at=now() WHERE id=$1`,
      [p.id, f.name, f.category || null, f.description || null, c.price, c.compare, c.stock, f.active]);
    await saveProductImages(p.id, req.session.user.id, f.images);
    await saveVariants(p.id, c.variants);
    go(res, '/seller/products', 'Product updated.');
  } catch (err) { dbError(res, err); }
});

// Quickly change price / stock (from the list)
router.post('/seller/products/:id/quick', guard, async (req, res) => {
  try {
    const p = await ownProduct(req.shop.id, req.params.id);
    if (!p) return go(res, '/seller/products', 'Product not found.', 'error');
    const price = S.toRs(req.body.price_rs);
    const stock = S.toRs(req.body.stock);
    if (!price || price > 9999999) return go(res, '/seller/products', 'Enter a valid price.', 'error');
    if (stock === null || stock > 99999) return go(res, '/seller/products', 'Enter a valid stock.', 'error');
    // Stock of a product with variants is not changed here (each variant's stock is on the edit page)
    const hasVariants = (await pool.query('SELECT 1 FROM product_variants WHERE product_id = $1 LIMIT 1', [p.id])).rowCount > 0;
    await pool.query(
      `UPDATE products SET price_rs = $2, stock = CASE WHEN $4::boolean THEN stock ELSE $3 END, updated_at = now(),
         compare_price_rs = CASE WHEN compare_price_rs IS NOT NULL AND compare_price_rs > $2 THEN compare_price_rs ELSE NULL END WHERE id = $1`,
      [p.id, price, stock, hasVariants]);
    go(res, '/seller/products', `"${p.name.slice(0, 40)}" updated.`);
  } catch (err) { dbError(res, err); }
});

router.post('/seller/products/:id/soldout', guard, async (req, res) => {
  try {
    const p = await ownProduct(req.shop.id, req.params.id);
    if (p) {
      await pool.query('UPDATE product_variants SET stock = 0 WHERE product_id = $1', [p.id]);
      await pool.query('UPDATE products SET stock = 0, updated_at = now() WHERE id = $1', [p.id]);
    }
    go(res, '/seller/products', p ? 'Product is now sold out.' : 'Product not found.', p ? 'msg' : 'error');
  } catch (err) { dbError(res, err); }
});

router.post('/seller/products/:id/toggle', guard, async (req, res) => {
  try {
    const p = await ownProduct(req.shop.id, req.params.id);
    if (p) await pool.query('UPDATE products SET is_active = NOT is_active, updated_at = now() WHERE id = $1', [p.id]);
    go(res, '/seller/products', p ? (p.is_active ? 'Product hidden.' : 'Product is visible again.') : 'Product not found.', p ? 'msg' : 'error');
  } catch (err) { dbError(res, err); }
});

router.post('/seller/products/:id/delete', guard, async (req, res) => {
  try {
    const p = await ownProduct(req.shop.id, req.params.id);
    if (!p) return go(res, '/seller/products', 'Product not found.', 'error');
    const imgs = (await pool.query('SELECT image_id FROM product_images WHERE product_id = $1', [p.id])).rows.map((r) => r.image_id);
    await pool.query('DELETE FROM products WHERE id = $1', [p.id]); // old orders are safe: they keep the saved name / price
    for (const id of imgs) await Images.dropIfOrphan(id, null).catch(() => {});
    go(res, '/seller/products', 'Product removed.');
  } catch (err) { dbError(res, err); }
});

// ============================================================
// ORDERS
// ============================================================
const PAGE = 40;
router.get('/seller/orders', guard, async (req, res) => {
  try {
    const status = S.STATUSES.includes(req.query.status) ? req.query.status : '';
    const q = S.oneLine(req.query.q, 40);
    const page = Math.max(1, Math.min(parseInt(req.query.page, 10) || 1, 1000));
    const counts = {};
    (await pool.query('SELECT status, COUNT(*)::int AS n FROM orders WHERE shop_id = $1 GROUP BY status', [req.shop.id])).rows.forEach((r) => { counts[r.status] = r.n; });
    const params = [req.shop.id];
    let where = 'o.shop_id = $1';
    if (status) { params.push(status); where += ` AND o.status = $${params.length}`; }
    if (q) {
      params.push('%' + q.replace(/[%_\\]/g, '\\$&') + '%');
      const idN = /^#?\d{1,9}$/.test(q) ? parseInt(q.replace('#', ''), 10) : 0;
      params.push(idN);
      where += ` AND (o.customer_name ILIKE $${params.length - 1} OR o.phone ILIKE $${params.length - 1} OR o.city ILIKE $${params.length - 1} OR o.product_name ILIKE $${params.length - 1} OR o.tracking_no ILIKE $${params.length - 1} OR o.id = $${params.length})`;
    }
    const total = (await pool.query(`SELECT COUNT(*)::int AS n FROM orders o WHERE ${where}`, params)).rows[0].n;
    const orders = (await pool.query(
      `SELECT o.*, g.name AS group_name, g.platform AS group_platform
       FROM orders o LEFT JOIN shop_groups g ON g.shop_id = o.shop_id AND g.utm = o.campaign
       WHERE ${where} ORDER BY o.id DESC LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`, params)).rows;
    await S.attachItems(orders);
    const waStatus = await WA.statusMap(orders.map((o) => o.id));
    const base = S.baseUrlOf(req);
    orders.forEach((o) => {
      const kind = o.status === 'new' ? 'placed' : 'tracking';
      o.waManual = WA.manualLink(kind, o, req.shop.name, base); // so the seller can send it manually if the auto message is off / fails
    });
    render(res, 'seller-orders', {
      title: 'Orders', orders, waStatus, waAuto: WA.enabled(), COURIERS: couriers.COURIERS, couriers, counts, status, q, page, pages: Math.max(1, Math.ceil(total / PAGE)), total,
      allCount: Object.values(counts).reduce((a, b) => a + b, 0),
      STATUSES: S.STATUSES, STATUS_LABEL: S.STATUS_LABEL, STATUS_COLOR: S.STATUS_COLOR, PAY_LABEL: S.PAY_LABEL,
      seller: 'orders', ...flashOf(req),
    });
  } catch (err) { dbError(res, err); }
});

router.post('/seller/orders/:id/status', guard, async (req, res) => {
  const back = '/seller/orders' + (S.STATUSES.includes(req.body.back) ? '?status=' + req.body.back : '');
  try {
    const id = S.toId(req.params.id);
    if (!id) return go(res, back, 'Order not found.', 'error');
    const prev = (await pool.query('SELECT status FROM orders WHERE id = $1 AND shop_id = $2', [id, req.shop.id])).rows[0];
    if (!prev) return go(res, back, 'Order not found.', 'error');
    if (prev.status === 'returned') return go(res, back, 'A returned order cannot be changed again.', 'error');
    const o = await S.setOrderStatus(req.shop.id, id, req.body.status);
    if (!o) return go(res, back, 'Status was not changed.', 'error');
    if (o.status !== prev.status && o.user_id) {
      const row = (await pool.query('SELECT token FROM orders WHERE id = $1', [id])).rows[0];
      notifyUser(o.user_id, `Your order #${id} (${o.product_name}): ${S.STATUS_LABEL[o.status]}`, '/order/' + row.token).catch(() => {});
    }
    // Shipped: send the customer a "dispatched" WhatsApp message (the tracking message if a tracking number is already set)
    if (o.status === 'shipped' && prev.status !== 'shipped') {
      WA.sendOrderMessage(id, o.tracking_no ? 'tracking' : 'dispatched').catch(() => {});
    }
    go(res, back, `Order #${id}: ${S.STATUS_LABEL[o.status]}` + (o.status === 'returned' ? ' (stock restored)' : ''));
  } catch (err) { dbError(res, err); }
});

// ---------- CSV export (opens in Excel) ----------
const csvCell = (v) => {
  let t = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; // protect against Excel formula injection
  return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
};
router.get('/seller/orders.csv', guard, async (req, res) => {
  try {
    const status = S.STATUSES.includes(req.query.status) ? req.query.status : '';
    const params = [req.shop.id];
    let where = 'o.shop_id = $1';
    if (status) { params.push(status); where += ' AND o.status = $2'; }
    const orders = (await pool.query(`SELECT o.* FROM orders o WHERE ${where} ORDER BY o.id DESC LIMIT 5000`, params)).rows;
    await S.attachItems(orders);
    const head = ['Order #', 'Date', 'Status', 'Name', 'Phone', 'City', 'Address', 'Items', 'Delivery Rs', 'Discount Rs', 'Coupon', 'Total Rs', 'Payment', 'Courier', 'Tracking', 'Source', 'Note'];
    const lines = [head.map(csvCell).join(',')];
    orders.forEach((o) => {
      lines.push([
        o.id, new Date(o.created_at).toLocaleString('en-GB', { timeZone: TZ }), S.STATUS_LABEL[o.status] || o.status,
        o.customer_name, S.showPhone(o.phone), o.city, o.address,
        o.items.map((it) => `${it.product_name}${it.variant_label ? ' (' + it.variant_label + ')' : ''} x ${it.qty}`).join(' | '),
        o.delivery_rs, o.discount_rs || 0, o.coupon_code || '', o.total_rs, S.PAY_LABEL[o.payment_method] || o.payment_method,
        o.courier ? couriers.nameOf(o.courier) || o.courier : '', o.tracking_no || '', o.source || 'direct', o.note || '',
      ].map(csvCell).join(','));
    });
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="orders-${req.shop.slug}${status ? '-' + status : ''}.csv"` });
    res.send('\ufeff' + lines.join('\r\n'));
  } catch (err) { dbError(res, err); }
});

// ---------- Packing slip / shipping label (for printing) ----------
router.get('/seller/orders/:id/slip', guard, async (req, res) => {
  try {
    const id = S.toId(req.params.id);
    const o = id ? (await pool.query('SELECT * FROM orders WHERE id = $1 AND shop_id = $2', [id, req.shop.id])).rows[0] : null;
    if (!o) return go(res, '/seller/orders', 'Order not found.', 'error');
    await S.attachItems([o]);
    res.render('seller-slip', {
      title: 'Slip #' + o.id, robots: 'noindex,nofollow', o, shop: req.shop, rs: S.rs, showPhone: S.showPhone,
      PAY_LABEL: S.PAY_LABEL, courierName: o.courier ? couriers.nameOf(o.courier) || o.courier : '',
      cod: o.payment_method === 'cod', csrfToken: res.locals.csrfToken,
    });
  } catch (err) { dbError(res, err); }
});

// Courier + tracking number: marks the order "Shipped" (if it is still New), shows a "Track" button on the
// customer's order page and sends the customer the tracking WhatsApp message (only once per order).
router.post('/seller/orders/:id/ship', guard, async (req, res) => {
  const back = '/seller/orders' + (S.STATUSES.includes(req.body.back) ? '?status=' + req.body.back : '');
  try {
    const id = S.toId(req.params.id);
    if (!id) return go(res, back, 'Order not found.', 'error');
    const cur = (await pool.query('SELECT * FROM orders WHERE id = $1 AND shop_id = $2', [id, req.shop.id])).rows[0];
    if (!cur) return go(res, back, 'Order not found.', 'error');
    if (cur.status === 'returned') return go(res, back, 'Tracking cannot be added to a returned order.', 'error');
    const courier = couriers.byKey(String(req.body.courier || ''));
    if (!courier) return go(res, back, 'Select a courier.', 'error');
    const no = couriers.cleanTracking(req.body.tracking_no);
    if (!no) return go(res, back, 'Enter a valid tracking number (4 to 30 letters / digits, e.g. TCS123456789).', 'error');
    await pool.query('UPDATE orders SET courier = $2, tracking_no = $3, updated_at = now() WHERE id = $1', [id, courier.key, no]);
    let now = cur;
    if (cur.status === 'new') now = (await S.setOrderStatus(req.shop.id, id, 'shipped')) || cur;
    if (cur.user_id) {
      notifyUser(cur.user_id, `Your order #${id} has been shipped via ${courier.name}. Tracking: ${no}`, '/order/' + cur.token).catch(() => {});
    }
    WA.sendOrderMessage(id, 'tracking').catch(() => {});
    go(res, back, `Order #${id}: ${courier.name} tracking ${no} saved` + (cur.status === 'new' && now.status === 'shipped' ? ' and the order is marked "Shipped".' : '.'));
  } catch (err) { dbError(res, err); }
});

// ============================================================
// COUPONS (V56): e.g. TIKTOK10 = 10% off for people coming from TikTok. Orders / sales are counted per coupon.
// ============================================================
function readCouponForm(b) {
  return {
    code: S.cleanCode(b.code),
    kind: b.kind === 'flat' ? 'flat' : 'percent',
    value: S.oneLine(b.value, 7),
    min: S.oneLine(b.min_order_rs, 7),
    max: S.oneLine(b.max_uses, 6),
    source: S.COUPON_SOURCES.includes(b.only_source) ? b.only_source : '',
    expires: /^\d{4}-\d{2}-\d{2}$/.test(String(b.expires || '')) ? String(b.expires) : '',
  };
}
function checkCouponForm(f) {
  if (f.code.length < 3) return { error: 'Enter a coupon code of at least 3 letters / digits (e.g. TIKTOK10).' };
  const value = S.toRs(f.value);
  if (!value) return { error: 'Enter a valid discount amount.' };
  if (f.kind === 'percent' && value > 90) return { error: 'Enter a percent discount between 1 and 90.' };
  if (f.kind === 'flat' && value > 999999) return { error: 'The discount amount is too high.' };
  const min = f.min === '' ? 0 : S.toRs(f.min);
  if (min === null || min > 9999999) return { error: 'Enter a valid minimum order amount or leave it empty.' };
  let max = null;
  if (f.max !== '') { max = S.toRs(f.max); if (!max || max > 999999) return { error: 'Maximum uses: enter a valid number or leave it empty.' }; }
  // The expiry date is valid until the end of that day (in the site's timezone)
  const expires = f.expires ? f.expires + ' 23:59:59' : null;
  return { value, min, max, expires };
}
const renderCoupons = async (req, res, { code = 200, f = null, error = null } = {}) => {
  const coupons = (await pool.query(
    `SELECT c.*, COALESCE(o.orders, 0)::int AS orders, COALESCE(o.sales, 0)::int AS sales, COALESCE(o.off, 0)::int AS off
       FROM coupons c
       LEFT JOIN (SELECT coupon_id, COUNT(*) AS orders, SUM(total_rs) AS sales, SUM(discount_rs) AS off FROM orders
                   WHERE shop_id = $1 AND coupon_id IS NOT NULL AND status <> 'returned' GROUP BY coupon_id) o ON o.coupon_id = c.id
      WHERE c.shop_id = $1 ORDER BY c.is_active DESC, c.created_at DESC`, [req.shop.id])).rows;
  render(res, 'seller-coupons', {
    code, title: 'Coupons', coupons, f: f || { code: '', kind: 'percent', value: '10', min: '', max: '', source: '', expires: '' }, error,
    SOURCES: S.COUPON_SOURCES, couponText: S.couponText, seller: 'coupons', TZ, ...flashOf(req),
  });
};
router.get('/seller/coupons', guard, async (req, res) => {
  try { await renderCoupons(req, res); } catch (err) { dbError(res, err); }
});
router.post('/seller/coupons', guard, async (req, res) => {
  try {
    const f = readCouponForm(req.body || {});
    const c = checkCouponForm(f);
    if (c.error) return renderCoupons(req, res, { code: 400, f, error: c.error });
    const n = (await pool.query('SELECT COUNT(*)::int AS n FROM coupons WHERE shop_id = $1', [req.shop.id])).rows[0].n;
    if (n >= MAX_COUPONS) return renderCoupons(req, res, { code: 400, f, error: `A shop cannot have more than ${MAX_COUPONS} coupons. Please remove some old ones.` });
    try {
      await pool.query(
        `INSERT INTO coupons (shop_id, code, kind, value, min_order_rs, max_uses, only_source, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $8::text IS NULL THEN NULL ELSE ($8::timestamp AT TIME ZONE $9::text) END)`,
        [req.shop.id, f.code, f.kind, c.value, c.min, c.max, f.source || null, c.expires, TZ]);
    } catch (err) {
      if (err.code === '23505') return renderCoupons(req, res, { code: 400, f, error: `Coupon "${f.code}" already exists.` });
      throw err;
    }
    go(res, '/seller/coupons', `Coupon ${f.code} created.`);
  } catch (err) { dbError(res, err); }
});
const ownCoupon = async (shopId, id) => {
  const cid = S.toId(id);
  return cid ? (await pool.query('SELECT * FROM coupons WHERE id = $1 AND shop_id = $2', [cid, shopId])).rows[0] || null : null;
};
router.post('/seller/coupons/:id/toggle', guard, async (req, res) => {
  try {
    const c = await ownCoupon(req.shop.id, req.params.id);
    if (c) await pool.query('UPDATE coupons SET is_active = NOT is_active WHERE id = $1', [c.id]);
    go(res, '/seller/coupons', c ? (c.is_active ? `Coupon ${c.code} deactivated.` : `Coupon ${c.code} activated again.`) : 'Coupon not found.', c ? 'msg' : 'error');
  } catch (err) { dbError(res, err); }
});
router.post('/seller/coupons/:id/delete', guard, async (req, res) => {
  try {
    const c = await ownCoupon(req.shop.id, req.params.id);
    if (c) await pool.query('DELETE FROM coupons WHERE id = $1', [c.id]); // old orders keep the coupon_code
    go(res, '/seller/coupons', c ? `Coupon ${c.code} removed.` : 'Coupon not found.', c ? 'msg' : 'error');
  } catch (err) { dbError(res, err); }
});

// ============================================================
// SHARE: group-wise product links (like Group Poster)
// ============================================================
const detectPlatform = (link, fallback) => {
  if (/whatsapp\.com|wa\.me/i.test(link)) return 'whatsapp';
  if (/facebook\.com|fb\.com|fb\.me/i.test(link)) return 'facebook';
  if (/t\.me|telegram\./i.test(link)) return 'telegram';
  if (/instagram\.com/i.test(link)) return 'instagram';
  return fallback;
};
const shareBack = (b) => (/^\/seller\/share\/\d+$/.test(String(b || '')) ? b : '/seller/share');

router.get('/seller/share', guard, async (req, res) => {
  try {
    const r = await pool.query('SELECT id FROM products WHERE shop_id = $1 AND is_active = true ORDER BY created_at DESC LIMIT 1', [req.shop.id]);
    if (!r.rows[0]) return go(res, '/seller/products/new', 'Add a product first, then you can create its group link.', 'error');
    res.redirect('/seller/share/' + r.rows[0].id);
  } catch (err) { dbError(res, err); }
});

router.get('/seller/share/:id', guard, async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return next();
  try {
    const product = await ownProduct(req.shop.id, req.params.id);
    if (!product) return go(res, '/seller/products', 'Product not found.', 'error');
    const groups = (await pool.query(
      `SELECT g.id, g.name, g.platform, g.link, g.utm,
              EXISTS (SELECT 1 FROM shop_group_posted s WHERE s.group_id = g.id AND s.product_id = $1
                      AND s.posted_on = (now() AT TIME ZONE $3::text)::date) AS done,
              COALESCE(v.visits, 0)::int AS visits, COALESCE(v.people, 0)::int AS people, COALESCE(o.orders, 0)::int AS orders
       FROM shop_groups g
       LEFT JOIN (SELECT campaign, COUNT(*) AS visits, COUNT(DISTINCT visitor) AS people FROM product_visits
                  WHERE product_id = $1 AND campaign IS NOT NULL GROUP BY campaign) v ON v.campaign = g.utm
       LEFT JOIN (SELECT campaign, COUNT(*) AS orders FROM orders
                  WHERE product_id = $1 AND campaign IS NOT NULL GROUP BY campaign) o ON o.campaign = g.utm
       WHERE g.shop_id = $2 ORDER BY g.platform, lower(g.name)`, [product.id, req.shop.id, TZ])).rows;
    const recent = (await pool.query('SELECT id, name FROM products WHERE shop_id = $1 ORDER BY created_at DESC LIMIT 60', [req.shop.id])).rows;
    const base = S.baseUrlOf(req);
    const pUrl = `${base}/shop/${req.shop.slug}/${product.slug}`;
    let canImport = false;
    if (req.session.user.role === 'admin') {
      try { canImport = (await pool.query('SELECT COUNT(*)::int AS n FROM share_groups')).rows[0].n > 0; } catch (e) { /* migration_v42 not applied */ }
    }
    const desc = String(product.description || '').replace(/\s+/g, ' ').slice(0, 110);
    render(res, 'seller-share', {
      title: 'Share product', product, recent, canImport, PLATFORMS: S.PLATFORMS, seller: 'share', ...flashOf(req),
      caption: `🛍️ ${product.name}\n💰 Rs ${S.rs(product.price_rs)}` + (desc ? `\n\n${desc}${product.description.length > 110 ? '...' : ''}` : '') + `\n\n🚚 Cash on Delivery\n👉 Order now: {link}`,
      groups: groups.map((g) => ({ ...g, url: `${pUrl}?utm_source=${g.platform}&utm_medium=group&utm_campaign=${g.utm}` })),
      doneCount: groups.filter((g) => g.done).length,
    });
  } catch (err) { dbError(res, err); }
});

router.post('/seller/share/groups', guard, async (req, res) => {
  const back = shareBack(req.body.back);
  try {
    const fallback = S.PLATFORMS.includes(req.body.platform) ? req.body.platform : 'whatsapp';
    const lines = String(req.body.groups || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 100);
    let added = 0; let skipped = 0;
    const have = (await pool.query('SELECT COUNT(*)::int AS n FROM shop_groups WHERE shop_id = $1', [req.shop.id])).rows[0].n;
    for (const line of lines) {
      if (have + added >= MAX_GROUPS) { skipped++; continue; }
      let name = line; let link = '';
      const m = line.match(/^(.*?)\s*[|,]\s*(https?:\/\/\S+)\s*$/i) || line.match(/^(.*?)\s+(https?:\/\/\S+)\s*$/i);
      if (m) { name = m[1].trim(); link = m[2].trim(); }
      else if (/^https?:\/\//i.test(line)) { name = ''; link = line; }
      if (!name) name = link ? link.replace(/^https?:\/\/(www\.)?/i, '').slice(0, 40) : '';
      name = name.slice(0, 80);
      if (link) { const cl = cleanLink(link); link = cl.ok ? cl.url : ''; }
      if (!name) { skipped++; continue; }
      const utm = (slugify(name).replace(/^post$/, 'grp').slice(0, 30) + '-' + crypto.randomBytes(2).toString('hex')).slice(0, 60);
      await pool.query('INSERT INTO shop_groups (shop_id, name, platform, link, utm) VALUES ($1,$2,$3,$4,$5)',
        [req.shop.id, name, detectPlatform(link, fallback), link || null, utm]);
      added++;
    }
    go(res, back, `${added} groups saved` + (skipped ? `, ${skipped} skipped (empty or limit reached)` : ''));
  } catch (err) { console.error(err); go(res, back, 'Could not save the group.', 'error'); }
});

// Admin: bring the Group Poster groups into this shop (same UTM, so old analytics carry over too)
router.post('/seller/share/import', guard, async (req, res) => {
  const back = shareBack(req.body.back);
  try {
    if (req.session.user.role !== 'admin') return deny(res, 'Only the site owner can do this.');
    const r = await pool.query(
      `INSERT INTO shop_groups (shop_id, name, platform, link, utm)
       SELECT $1, name, platform, link, utm FROM share_groups ON CONFLICT (shop_id, utm) DO NOTHING`, [req.shop.id]);
    go(res, back, `${r.rowCount} groups imported from Group Poster.`);
  } catch (err) { console.error(err); go(res, back, 'Import failed.', 'error'); }
});

router.post('/seller/share/groups/:gid/delete', guard, async (req, res) => {
  try {
    const gid = S.toId(req.params.gid);
    if (gid) await pool.query('DELETE FROM shop_groups WHERE id = $1 AND shop_id = $2', [gid, req.shop.id]);
  } catch (err) { console.error(err); }
  res.redirect(shareBack(req.body.back));
});

router.post('/seller/share/:id/tick/:gid', guard, async (req, res) => {
  const pid = S.toId(req.params.id); const gid = S.toId(req.params.gid);
  if (!pid || !gid) return res.status(400).json({ error: 'bad id' });
  try {
    const ok = await pool.query(
      'SELECT 1 FROM products p JOIN shop_groups g ON g.shop_id = p.shop_id WHERE p.id = $1 AND g.id = $2 AND p.shop_id = $3', [pid, gid, req.shop.id]);
    if (!ok.rowCount) return res.status(404).json({ error: 'not found' });
    const del = await pool.query(
      `DELETE FROM shop_group_posted WHERE group_id = $1 AND product_id = $2 AND posted_on = (now() AT TIME ZONE $3::text)::date`, [gid, pid, TZ]);
    if (del.rowCount > 0) return res.json({ done: false });
    await pool.query(
      `INSERT INTO shop_group_posted (group_id, product_id, posted_on) VALUES ($1, $2, (now() AT TIME ZONE $3::text)::date) ON CONFLICT DO NOTHING`, [gid, pid, TZ]);
    res.json({ done: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'failed' }); }
});

// ============================================================
// ANALYTICS: how many people came from each group / source and how many ordered
// ============================================================
router.get('/seller/analytics', guard, async (req, res) => {
  try {
    const days = [7, 30, 90].includes(parseInt(req.query.days, 10)) ? parseInt(req.query.days, 10) : 30;
    const id = req.shop.id;
    const since = `now() - ($2::int * interval '1 day')`;
    const tot = (await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM product_visits WHERE shop_id = $1 AND created_at > ${since}) AS visits,
         (SELECT COUNT(DISTINCT visitor)::int FROM product_visits WHERE shop_id = $1 AND created_at > ${since}) AS people,
         (SELECT COUNT(*)::int FROM orders WHERE shop_id = $1 AND created_at > ${since}) AS orders,
         (SELECT COALESCE(SUM(total_rs), 0)::int FROM orders WHERE shop_id = $1 AND status <> 'returned' AND created_at > ${since}) AS revenue,
         (SELECT COUNT(*)::int FROM orders WHERE shop_id = $1 AND status = 'returned' AND created_at > ${since}) AS returned`, [id, days])).rows[0];

    const byGroup = (await pool.query(
      `SELECT g.id, g.name, g.platform,
              COALESCE(v.visits, 0)::int AS visits, COALESCE(v.people, 0)::int AS people,
              COALESCE(o.orders, 0)::int AS orders, COALESCE(o.units, 0)::int AS units, COALESCE(o.revenue, 0)::int AS revenue,
              COALESCE(o.returned, 0)::int AS returned
       FROM shop_groups g
       LEFT JOIN (SELECT campaign, COUNT(*) AS visits, COUNT(DISTINCT visitor) AS people FROM product_visits
                  WHERE shop_id = $1 AND campaign IS NOT NULL AND created_at > ${since} GROUP BY campaign) v ON v.campaign = g.utm
       LEFT JOIN (SELECT campaign, COUNT(*) AS orders, SUM(qty) AS units,
                         SUM(CASE WHEN status <> 'returned' THEN total_rs ELSE 0 END) AS revenue,
                         COUNT(*) FILTER (WHERE status = 'returned') AS returned FROM orders
                  WHERE shop_id = $1 AND campaign IS NOT NULL AND created_at > ${since} GROUP BY campaign) o ON o.campaign = g.utm
       WHERE g.shop_id = $1 ORDER BY orders DESC, visits DESC, lower(g.name)`, [id, days])).rows;

    // Source-wise: visits and orders are fetched separately and merged (direct / google / blog / group ...)
    const vSrc = (await pool.query(
      `SELECT COALESCE(source, 'direct') AS source, COUNT(*)::int AS visits, COUNT(DISTINCT visitor)::int AS people FROM product_visits
       WHERE shop_id = $1 AND created_at > ${since} GROUP BY 1`, [id, days])).rows;
    const oSrc = (await pool.query(
      `SELECT COALESCE(source, 'direct') AS source, COUNT(*)::int AS orders, COALESCE(SUM(CASE WHEN status <> 'returned' THEN total_rs ELSE 0 END), 0)::int AS revenue FROM orders
       WHERE shop_id = $1 AND created_at > ${since} GROUP BY 1`, [id, days])).rows;
    const srcMap = {};
    vSrc.forEach((r) => { srcMap[r.source] = { source: r.source, visits: r.visits, people: r.people, orders: 0, revenue: 0 }; });
    oSrc.forEach((r) => { srcMap[r.source] = { source: r.source, visits: 0, people: 0, ...(srcMap[r.source] || {}), orders: r.orders, revenue: r.revenue }; });
    const bySource = Object.values(srcMap).sort((a, b) => b.orders - a.orders || b.visits - a.visits);

    const byProduct = (await pool.query(
      `SELECT p.id, p.name, p.slug, p.stock,
              (SELECT COUNT(*)::int FROM product_visits v WHERE v.product_id = p.id AND v.created_at > ${since}) AS visits,
              (SELECT COUNT(DISTINCT oi.order_id)::int FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id AND o.created_at > ${since}) AS orders,
              (SELECT COALESCE(SUM(oi.unit_price_rs * oi.qty), 0)::int FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id AND o.status <> 'returned' AND o.created_at > ${since}) AS revenue
       FROM products p WHERE p.shop_id = $1 ORDER BY orders DESC, visits DESC LIMIT 50`, [id, days])).rows;

    // People who came from the blog post's "Buy this product" card
    const vPost = (await pool.query(
      `SELECT campaign, COUNT(*)::int AS visits FROM product_visits
       WHERE shop_id = $1 AND medium = 'post_card' AND campaign IS NOT NULL AND created_at > ${since} GROUP BY campaign`, [id, days])).rows;
    const oPost = (await pool.query(
      `SELECT campaign, COUNT(*)::int AS orders FROM orders
       WHERE shop_id = $1 AND medium = 'post_card' AND campaign IS NOT NULL AND created_at > ${since} GROUP BY campaign`, [id, days])).rows;
    const pm = {};
    vPost.forEach((r) => { pm[r.campaign] = { campaign: r.campaign, visits: r.visits, orders: 0 }; });
    oPost.forEach((r) => { pm[r.campaign] = { visits: 0, ...(pm[r.campaign] || {}), campaign: r.campaign, orders: r.orders }; });
    const byPost = Object.values(pm).sort((a, b) => b.orders - a.orders || b.visits - a.visits).slice(0, 20);

    // Recent visitors: who came and from where (empty list if migration_v50 has not run)
    let recent = [];
    try {
      const isAdmin = req.session.user && req.session.user.role === 'admin';
      const q = (ua) => pool.query(
        `SELECT v.created_at, v.ip, v.city, v.country, v.source, v.campaign, v.referrer, ${ua ? 'v.user_agent' : 'NULL::text AS user_agent'},
                v.visitor, v.user_id, p.name AS product, u.username, ipc.reqs, ipc.products
         FROM product_visits v
         JOIN products p ON p.id = v.product_id
         LEFT JOIN users u ON u.id = v.user_id
         JOIN (SELECT ip, COUNT(*)::int AS reqs, COUNT(DISTINCT product_id)::int AS products
               FROM product_visits WHERE shop_id = $1 AND created_at > ${since} AND ip IS NOT NULL GROUP BY ip) ipc ON ipc.ip = v.ip
         WHERE v.shop_id = $1 AND v.created_at > ${since} AND v.ip IS NOT NULL
         ORDER BY v.created_at DESC LIMIT 50`, [id, days]);
      let rows;
      try { rows = (await q(true)).rows; } catch (e) {
        if (e.code !== '42703') throw e;
        rows = (await q(false)).rows; // migration_v53 pending
      }
      recent = rows.map((r) => ({
        ...r,
        ipShown: isAdmin ? r.ip : maskIp(r.ip),
        ua: uaLabel(r.user_agent),
        who: r.username || 'Guest #' + String(r.visitor || '').slice(-4),
        countryName: r.country ? countryName(r.country) : '-',
        flag: r.country ? flag(r.country) : '',
      }));
    } catch (err) {
      if (err.code !== '42703') console.error('[seller] recent visitors:', err.message);
    }

    render(res, 'seller-analytics', { title: 'Shop analytics', days, tot, byGroup, bySource, byProduct, byPost, recent, seller: 'analytics' });
  } catch (err) { dbError(res, err); }
});

// ============================================================
// ADMIN: all shops
// ============================================================
router.get('/admin/shops', requireAdmin, async (req, res) => {
  try {
    const shops = (await pool.query(
      `SELECT s.*, u.username,
              (SELECT COUNT(*)::int FROM products p WHERE p.shop_id = s.id) AS products,
              (SELECT COUNT(*)::int FROM orders o WHERE o.shop_id = s.id) AS orders,
              (SELECT COALESCE(SUM(o.total_rs), 0)::int FROM orders o WHERE o.shop_id = s.id AND o.status = 'delivered') AS delivered_rs
       FROM shops s JOIN users u ON u.id = s.owner_id ORDER BY (s.status = 'pending') DESC, s.created_at DESC LIMIT 500`)).rows;
    render(res, 'admin-shops', { title: 'Shops', shops, ...flashOf(req) });
  } catch (err) { dbError(res, err); }
});

router.post('/admin/shops/:id/status', requireAdmin, async (req, res) => {
  try {
    const id = S.toId(req.params.id);
    const status = ['active', 'suspended', 'pending'].includes(req.body.status) ? req.body.status : null;
    if (!id || !status) return go(res, '/admin/shops', 'Invalid request.', 'error');
    const r = await pool.query('UPDATE shops SET status = $2 WHERE id = $1 RETURNING owner_id, name, slug', [id, status]);
    if (r.rows[0] && r.rows[0].owner_id !== req.session.user.id) {
      const text = status === 'active' ? `Your shop "${r.rows[0].name}" is now public.` : status === 'suspended' ? `Your shop "${r.rows[0].name}" has been suspended. Please contact the site owner for details.` : `Your shop "${r.rows[0].name}" is under review.`;
      notifyUser(r.rows[0].owner_id, text, '/seller', { email: status !== 'pending' }).catch(() => {});
    }
    go(res, '/admin/shops', r.rows[0] ? `${r.rows[0].name}: ${status}` : 'Shop not found.', r.rows[0] ? 'msg' : 'error');
  } catch (err) { dbError(res, err); }
});

module.exports = router;
