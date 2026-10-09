// Shop (V46) seller panel: /seller (dashboard), /seller/open + /seller/settings, products, orders (status),
// /seller/share (group-wise UTM links, Group Poster jaisa), /seller/analytics (group-wise sales), /admin/shops.
const crypto = require('crypto');
const express = require('express');
const pool = require('../db');
const config = require('../config');
const S = require('../lib/shop');
const { maskIp, countryName, flag } = require('../lib/demographics');
const Restricted = require('../lib/restricted');
const Images = require('../lib/images');
const { slugify } = require('../lib/slug');
const { cleanLink } = require('../lib/ads');
const { notifyUser } = require('../lib/notify');

const router = express.Router();
const TZ = config.timezone;
const MAX_GROUPS = 300;

const flashOf = (req) => ({
  msg: req.query.msg ? String(req.query.msg).slice(0, 200) : null,
  error: req.query.error ? String(req.query.error).slice(0, 200) : null,
});
const go = (res, path, msg, key = 'msg') => res.redirect(path + (msg ? (path.includes('?') ? '&' : '?') + key + '=' + encodeURIComponent(msg) : ''));
const dbError = (res, err) => {
  if (err && (err.code === '42P01' || err.code === '42703')) {
    return res.status(503).render('404', { code: 503, title: 'Shop setup', message: 'Shop abhi setup ho rahi hai (migration_v46.sql). Thori der baad try karein.' });
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
// Seller ki apni shop load karo (nahi hai to shop kholne ka page)
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
  if (f.name.length < 3) return { error: 'Shop ka naam likhein (kam az kam 3 huroof).' };
  if (f.city.length < 2) return { error: 'Shehar ka naam likhein.' };
  const wa = S.cleanPhone(f.whatsapp);
  if (!wa) return { error: 'Apna WhatsApp number likhein, jaise 0300 1234567. Orders ki khabar isi par aati hai.' };
  const ph = S.cleanPhone(f.phone);
  if (ph === null) return { error: 'Phone number sahi nahi. Jaise 0300 1234567 (ya khali chhorein).' };
  if (!f.cod && !f.wa) return { error: 'Kam az kam ek tareeqa on rakhein: Cash on Delivery ya WhatsApp order.' };
  const fee = f.delivery_fee === '' ? 0 : S.toRs(f.delivery_fee);
  if (fee === null || fee > 100000) return { error: 'Delivery charges sahi likhein (sirf number, jaise 200).' };
  const free = f.free_over === '' ? null : S.toRs(f.free_over);
  if (f.free_over !== '' && (free === null || free > 10000000)) return { error: '"Itne se upar delivery free" sahi likhein (sirf number) ya khali chhorein.' };
  return { wa, ph: ph || null, fee, free };
}

router.get('/seller/open', requireLogin, async (req, res) => {
  try {
    if (await S.getMyShop(req.session.user.id)) return res.redirect('/seller');
    if (config.shopAdminOnly && req.session.user.role !== 'admin') return deny(res, 'Abhi nayi shops sirf site owner bana sakta hai.');
    render(res, 'seller-open', { title: 'Apni shop kholo', f: shopForm({}), error: null, edit: false, approval: config.shopApproval && req.session.user.role !== 'admin' });
  } catch (err) { dbError(res, err); }
});

router.post('/seller/open', requireLogin, async (req, res) => {
  try {
    const me = req.session.user;
    if (await S.getMyShop(me.id)) return res.redirect('/seller');
    if (config.shopAdminOnly && me.role !== 'admin') return deny(res, 'Abhi nayi shops sirf site owner bana sakta hai.');
    const f = readShopForm(req.body || {});
    const c = await checkShopForm(f);
    const fail = (m) => render(res, 'seller-open', { title: 'Apni shop kholo', code: 400, f, error: m, edit: false, approval: config.shopApproval && me.role !== 'admin' });
    if (c.error) return fail(c.error);
    if (f.logo && !(await S.usableImage(parseInt(f.logo, 10), me.id, null))) f.logo = '';
    const slug = await S.uniqueShopSlug(f.name);
    const status = config.shopApproval && me.role !== 'admin' ? 'pending' : 'active';
    await pool.query(
      `INSERT INTO shops (owner_id, slug, name, tagline, description, city, whatsapp, phone, logo_image_id, cod_enabled, wa_enabled, delivery_fee_rs, free_over_rs, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [me.id, slug, f.name, f.tagline || null, f.description || null, f.city, c.wa, c.ph, f.logo ? parseInt(f.logo, 10) : null, f.cod, f.wa, c.fee, c.free, status]);
    go(res, '/seller/products/new', status === 'pending' ? 'Shop ban gayi! Site owner ki manzoori ke baad public hogi. Tab tak products daal sakte hain.' : 'Shop ban gayi! Ab pehla product daalein.');
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
    go(res, '/seller/settings', 'Settings save ho gayi.');
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
const blankProduct = () => ({ name: '', category: '', description: '', price: '', compare: '', stock: '10', active: true, images: [] });
const productFormOf = (p, images) => ({
  name: p.name, category: p.category || '', description: p.description || '', price: String(p.price_rs),
  compare: p.compare_price_rs ? String(p.compare_price_rs) : '', stock: String(p.stock), active: p.is_active, images,
});
function readProductForm(b) {
  const ids = String(b.image_ids || '').split(',').map((x) => S.toId(x.trim())).filter(Boolean);
  return {
    name: S.oneLine(b.name, 120), category: S.CATEGORIES.includes(b.category) ? b.category : '',
    description: S.multiLine(b.description, 3000),
    price: S.oneLine(b.price_rs, 10), compare: S.oneLine(b.compare_price_rs, 10), stock: S.oneLine(b.stock, 7),
    active: b.is_active === '1', images: [...new Set(ids)].slice(0, S.MAX_PRODUCT_PHOTOS),
  };
}
async function checkProductForm(f) {
  if (await Restricted.find([f.name, f.description, f.category].join('\n'))) return { error: Restricted.MSG_UR };
  if (f.name.length < 3) return { error: 'Product ka naam likhein (kam az kam 3 huroof).' };
  const price = S.toRs(f.price);
  if (!price || price > 9999999) return { error: 'Qeemat sahi likhein (sirf number, jaise 1500).' };
  let compare = null;
  if (f.compare !== '') {
    compare = S.toRs(f.compare);
    if (!compare || compare > 9999999) return { error: 'Purani qeemat sahi likhein ya khali chhorein.' };
    if (compare <= price) compare = null; // purani qeemat nayi se zyada ho tabhi dikhti hai
  }
  const stock = f.stock === '' ? 0 : S.toRs(f.stock);
  if (stock === null || stock > 99999) return { error: 'Stock sahi likhein (0 se 99999).' };
  return { price, compare, stock };
}
const renderProductForm = (res, req, { code = 200, f, error = null, edit = null }) =>
  render(res, 'seller-product-form', { code, title: edit ? 'Edit product' : 'New product', f, error, edit, CATEGORIES: S.CATEGORIES, MAX_PHOTOS: S.MAX_PRODUCT_PHOTOS, seller: 'products' });

// Product ki photos: list ke mutabiq save, hata di gayi photos agar kahin aur na lagi hon to saaf
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

router.get('/seller/products', guard, async (req, res) => {
  try {
    const items = (await pool.query(
      `SELECT p.id, p.slug, p.name, p.price_rs, p.compare_price_rs, p.stock, p.is_active, ${S.MAIN_IMG} AS image_id,
              (SELECT COALESCE(SUM(qty), 0)::int FROM orders o WHERE o.product_id = p.id AND o.status <> 'returned') AS sold
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
    if (n >= config.shopMaxProducts) return renderProductForm(res, req, { code: 400, f, error: `Ek shop mein ${config.shopMaxProducts} products tak ki ijazat hai.` });
    const slug = await S.uniqueProductSlug(req.shop.id, f.name);
    const ins = await pool.query(
      `INSERT INTO products (shop_id, slug, name, category, description, price_rs, compare_price_rs, stock, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [req.shop.id, slug, f.name, f.category || null, f.description || null, c.price, c.compare, c.stock, f.active]);
    await saveProductImages(ins.rows[0].id, req.session.user.id, f.images);
    go(res, '/seller/products', 'Product add ho gaya.');
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
    if (!p) return go(res, '/seller/products', 'Product nahi mila.', 'error');
    const imgs = (await pool.query('SELECT image_id FROM product_images WHERE product_id = $1 ORDER BY position, image_id', [p.id])).rows.map((r) => r.image_id);
    renderProductForm(res, req, { f: productFormOf(p, imgs), edit: p });
  } catch (err) { dbError(res, err); }
});

router.post('/seller/products/:id', guard, async (req, res) => {
  try {
    const p = await ownProduct(req.shop.id, req.params.id);
    if (!p) return go(res, '/seller/products', 'Product nahi mila.', 'error');
    const f = readProductForm(req.body || {});
    const c = await checkProductForm(f);
    if (c.error) return renderProductForm(res, req, { code: 400, f, error: c.error, edit: p });
    await pool.query(
      `UPDATE products SET name=$2, category=$3, description=$4, price_rs=$5, compare_price_rs=$6, stock=$7, is_active=$8, updated_at=now() WHERE id=$1`,
      [p.id, f.name, f.category || null, f.description || null, c.price, c.compare, c.stock, f.active]);
    await saveProductImages(p.id, req.session.user.id, f.images);
    go(res, '/seller/products', 'Product update ho gaya.');
  } catch (err) { dbError(res, err); }
});

// Qeemat / stock jaldi badalna (list se)
router.post('/seller/products/:id/quick', guard, async (req, res) => {
  try {
    const p = await ownProduct(req.shop.id, req.params.id);
    if (!p) return go(res, '/seller/products', 'Product nahi mila.', 'error');
    const price = S.toRs(req.body.price_rs);
    const stock = S.toRs(req.body.stock);
    if (!price || price > 9999999) return go(res, '/seller/products', 'Qeemat sahi likhein.', 'error');
    if (stock === null || stock > 99999) return go(res, '/seller/products', 'Stock sahi likhein.', 'error');
    await pool.query(
      `UPDATE products SET price_rs = $2, stock = $3, updated_at = now(),
         compare_price_rs = CASE WHEN compare_price_rs IS NOT NULL AND compare_price_rs > $2 THEN compare_price_rs ELSE NULL END WHERE id = $1`,
      [p.id, price, stock]);
    go(res, '/seller/products', `"${p.name.slice(0, 40)}" update ho gaya.`);
  } catch (err) { dbError(res, err); }
});

router.post('/seller/products/:id/soldout', guard, async (req, res) => {
  try {
    const p = await ownProduct(req.shop.id, req.params.id);
    if (p) await pool.query('UPDATE products SET stock = 0, updated_at = now() WHERE id = $1', [p.id]);
    go(res, '/seller/products', p ? 'Product ab Sold out hai.' : 'Product nahi mila.', p ? 'msg' : 'error');
  } catch (err) { dbError(res, err); }
});

router.post('/seller/products/:id/toggle', guard, async (req, res) => {
  try {
    const p = await ownProduct(req.shop.id, req.params.id);
    if (p) await pool.query('UPDATE products SET is_active = NOT is_active, updated_at = now() WHERE id = $1', [p.id]);
    go(res, '/seller/products', p ? (p.is_active ? 'Product chhupa diya.' : 'Product dobara dikhne laga.') : 'Product nahi mila.', p ? 'msg' : 'error');
  } catch (err) { dbError(res, err); }
});

router.post('/seller/products/:id/delete', guard, async (req, res) => {
  try {
    const p = await ownProduct(req.shop.id, req.params.id);
    if (!p) return go(res, '/seller/products', 'Product nahi mila.', 'error');
    const imgs = (await pool.query('SELECT image_id FROM product_images WHERE product_id = $1', [p.id])).rows.map((r) => r.image_id);
    await pool.query('DELETE FROM products WHERE id = $1', [p.id]); // purane orders safe: unmein naam / qeemat saved hai
    for (const id of imgs) await Images.dropIfOrphan(id, null).catch(() => {});
    go(res, '/seller/products', 'Product hata diya.');
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
      where += ` AND (o.customer_name ILIKE $${params.length - 1} OR o.phone ILIKE $${params.length - 1} OR o.city ILIKE $${params.length - 1} OR o.product_name ILIKE $${params.length - 1} OR o.id = $${params.length})`;
    }
    const total = (await pool.query(`SELECT COUNT(*)::int AS n FROM orders o WHERE ${where}`, params)).rows[0].n;
    const orders = (await pool.query(
      `SELECT o.*, g.name AS group_name, g.platform AS group_platform
       FROM orders o LEFT JOIN shop_groups g ON g.shop_id = o.shop_id AND g.utm = o.campaign
       WHERE ${where} ORDER BY o.id DESC LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`, params)).rows;
    render(res, 'seller-orders', {
      title: 'Orders', orders, counts, status, q, page, pages: Math.max(1, Math.ceil(total / PAGE)), total,
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
    if (!id) return go(res, back, 'Order nahi mila.', 'error');
    const prev = (await pool.query('SELECT status FROM orders WHERE id = $1 AND shop_id = $2', [id, req.shop.id])).rows[0];
    if (!prev) return go(res, back, 'Order nahi mila.', 'error');
    if (prev.status === 'returned') return go(res, back, 'Wapas aa chuka order dobara nahi badal sakte.', 'error');
    const o = await S.setOrderStatus(req.shop.id, id, req.body.status);
    if (!o) return go(res, back, 'Status nahi badla.', 'error');
    if (o.status !== prev.status && o.user_id) {
      const row = (await pool.query('SELECT token FROM orders WHERE id = $1', [id])).rows[0];
      notifyUser(o.user_id, `Aap ka order #${id} (${o.product_name}): ${S.STATUS_LABEL[o.status]}`, '/order/' + row.token).catch(() => {});
    }
    go(res, back, `Order #${id}: ${S.STATUS_LABEL[o.status]}` + (o.status === 'returned' ? ' (stock wapas jur gaya)' : ''));
  } catch (err) { dbError(res, err); }
});

// ============================================================
// SHARE: group-wise product links (Group Poster jaisa)
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
    if (!r.rows[0]) return go(res, '/seller/products/new', 'Pehle ek product daalein, phir uska group link ban sakta hai.', 'error');
    res.redirect('/seller/share/' + r.rows[0].id);
  } catch (err) { dbError(res, err); }
});

router.get('/seller/share/:id', guard, async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return next();
  try {
    const product = await ownProduct(req.shop.id, req.params.id);
    if (!product) return go(res, '/seller/products', 'Product nahi mila.', 'error');
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
      try { canImport = (await pool.query('SELECT COUNT(*)::int AS n FROM share_groups')).rows[0].n > 0; } catch (e) { /* migration_v42 nahi */ }
    }
    const desc = String(product.description || '').replace(/\s+/g, ' ').slice(0, 110);
    render(res, 'seller-share', {
      title: 'Share product', product, recent, canImport, PLATFORMS: S.PLATFORMS, seller: 'share', ...flashOf(req),
      caption: `🛍️ ${product.name}\n💰 Rs ${S.rs(product.price_rs)}` + (desc ? `\n\n${desc}${product.description.length > 110 ? '...' : ''}` : '') + `\n\n🚚 Cash on Delivery\n👉 Order karo: {link}`,
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
    go(res, back, `${added} group save hue` + (skipped ? `, ${skipped} skip (khali ya limit)` : ''));
  } catch (err) { console.error(err); go(res, back, 'Group save nahi hua.', 'error'); }
});

// Admin: Group Poster ke groups isi shop mein le aao (wahi UTM, is liye purani analytics bhi mil jati hai)
router.post('/seller/share/import', guard, async (req, res) => {
  const back = shareBack(req.body.back);
  try {
    if (req.session.user.role !== 'admin') return deny(res, 'Only the site owner can do this.');
    const r = await pool.query(
      `INSERT INTO shop_groups (shop_id, name, platform, link, utm)
       SELECT $1, name, platform, link, utm FROM share_groups ON CONFLICT (shop_id, utm) DO NOTHING`, [req.shop.id]);
    go(res, back, `${r.rowCount} group Group Poster se aa gaye.`);
  } catch (err) { console.error(err); go(res, back, 'Import nahi hua.', 'error'); }
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
// ANALYTICS: kis group / source se kitne log aaye aur kitno ne order kiya
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

    // Source-wise: visits aur orders alag nikal kar milaye (direct / google / blog / group ...)
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
              (SELECT COUNT(*)::int FROM orders o WHERE o.product_id = p.id AND o.created_at > ${since}) AS orders,
              (SELECT COALESCE(SUM(o.total_rs), 0)::int FROM orders o WHERE o.product_id = p.id AND o.status <> 'returned' AND o.created_at > ${since}) AS revenue
       FROM products p WHERE p.shop_id = $1 ORDER BY orders DESC, visits DESC LIMIT 50`, [id, days])).rows;

    // Blog post ke "Ye product kharido" card se aaye log
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

    // Recent visitors: kon aaya, kahan se (migration_v50 na chali ho to khali list)
    let recent = [];
    try {
      const isAdmin = req.session.user && req.session.user.role === 'admin';
      const rows = (await pool.query(
        `SELECT v.created_at, v.ip, v.city, v.country, v.source, v.campaign, v.visitor, v.user_id, p.name AS product, u.username
         FROM product_visits v
         JOIN products p ON p.id = v.product_id
         LEFT JOIN users u ON u.id = v.user_id
         WHERE v.shop_id = $1 AND v.created_at > ${since} AND v.ip IS NOT NULL
         ORDER BY v.created_at DESC LIMIT 50`, [id, days])).rows;
      recent = rows.map((r) => ({
        ...r,
        ipShown: isAdmin ? r.ip : maskIp(r.ip),
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
// ADMIN: sab shops
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
    if (!id || !status) return go(res, '/admin/shops', 'Galat request.', 'error');
    const r = await pool.query('UPDATE shops SET status = $2 WHERE id = $1 RETURNING owner_id, name, slug', [id, status]);
    if (r.rows[0] && r.rows[0].owner_id !== req.session.user.id) {
      const text = status === 'active' ? `Aap ki shop "${r.rows[0].name}" ab public hai.` : status === 'suspended' ? `Aap ki shop "${r.rows[0].name}" band kar di gayi hai. Maloomat ke liye site owner se raabta karein.` : `Aap ki shop "${r.rows[0].name}" review mein hai.`;
      notifyUser(r.rows[0].owner_id, text, '/seller', { email: status !== 'pending' }).catch(() => {});
    }
    go(res, '/admin/shops', r.rows[0] ? `${r.rows[0].name}: ${status}` : 'Shop nahi mili.', r.rows[0] ? 'msg' : 'error');
  } catch (err) { dbError(res, err); }
});

module.exports = router;
