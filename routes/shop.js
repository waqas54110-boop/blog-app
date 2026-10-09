// Shop (V46) public side: /shop (sab products), /shop/:shop (ek shop), /shop/:shop/:product (product page + order form),
// POST /order (Cash on Delivery / WhatsApp), GET /order/:token (customer ka order page).
const express = require('express');
const pool = require('../db');
const config = require('../config');
const S = require('../lib/shop');
const { visitorId } = require('../lib/demographics');
const { notifyUser } = require('../lib/notify');

const router = express.Router();
const PER_PAGE = 24;

const notFound = (res, msg) => res.status(404).render('404', { code: 404, title: 'Not found', message: msg || 'This page does not exist.' });
const noShop = (res, err) => {
  if (err && (err.code === '42P01' || err.code === '42703')) {
    return res.status(503).render('404', { code: 503, title: 'Shop setup', message: 'Shop abhi setup ho rahi hai. Thori der baad try karein.' });
  }
  console.error(err);
  return res.status(500).send('Server error');
};

// ---------- /shop ----------
router.get('/shop', async (req, res) => {
  try {
    const q = S.oneLine(req.query.q, 60);
    const cat = S.CATEGORIES.includes(req.query.cat) ? req.query.cat : '';
    const page = Math.max(1, Math.min(parseInt(req.query.page, 10) || 1, 500));
    const where = [S.PUBLIC_WHERE];
    const params = [];
    if (q) { params.push('%' + q.replace(/[%_\\]/g, '\\$&') + '%'); where.push(`(p.name ILIKE $${params.length} OR p.category ILIKE $${params.length} OR s.name ILIKE $${params.length})`); }
    if (cat) { params.push(cat); where.push(`p.category = $${params.length}`); }
    const W = where.join(' AND ');
    const total = (await pool.query(`SELECT COUNT(*)::int AS n FROM products p JOIN shops s ON s.id = p.shop_id WHERE ${W}`, params)).rows[0].n;
    const items = (await pool.query(
      `SELECT ${S.CARD_COLS} FROM products p JOIN shops s ON s.id = p.shop_id WHERE ${W}
       ORDER BY (p.stock > 0) DESC, p.created_at DESC LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}`, params)).rows;
    const shops = (await pool.query(
      `SELECT s.slug, s.name, s.city, s.logo_image_id,
              (SELECT COUNT(*)::int FROM products p WHERE p.shop_id = s.id AND p.is_active) AS n
       FROM shops s WHERE s.status = 'active' AND EXISTS (SELECT 1 FROM products p WHERE p.shop_id = s.id AND p.is_active)
       ORDER BY s.created_at DESC LIMIT 12`)).rows;
    const myShop = req.session.user ? await S.getMyShop(req.session.user.id) : null;
    res.render('shop', {
      title: 'Shop - ' + config.siteName,
      metaDescription: 'Pakistani sellers ki shops: Cash on Delivery ya WhatsApp par order karein.',
      items, shops, q, cat, page, pages: Math.max(1, Math.ceil(total / PER_PAGE)), total, myShop,
      CATEGORIES: S.CATEGORIES, rs: S.rs,
      robots: q || page > 1 ? 'noindex,follow' : null,
    });
  } catch (err) { noShop(res, err); }
});

// ---------- /shop/:shop ----------
router.get('/shop/:shop', async (req, res, next) => {
  try {
    const shop = await S.getShopBySlug(req.params.shop);
    if (!shop) return notFound(res, 'Ye shop nahi mili.');
    const me = req.session.user;
    const mine = !!(me && (me.id === shop.owner_id || me.role === 'admin'));
    if (shop.status !== 'active' && !mine) return notFound(res, 'Ye shop abhi available nahi.');
    const items = (await pool.query(
      `SELECT ${S.CARD_COLS} FROM products p JOIN shops s ON s.id = p.shop_id
       WHERE p.shop_id = $1 AND p.is_active = true ORDER BY (p.stock > 0) DESC, p.created_at DESC LIMIT 200`, [shop.id])).rows;
    res.render('shop-store', {
      title: `${shop.name} - ${config.siteName}`,
      metaDescription: shop.tagline || shop.description || `${shop.name}: order karein Cash on Delivery ya WhatsApp par.`,
      ogImage: shop.logo_image_id ? S.baseUrlOf(req) + '/img/' + shop.logo_image_id : undefined,
      shop, items, mine, rs: S.rs, showPhone: S.showPhone,
      robots: shop.status === 'active' ? null : 'noindex,nofollow',
    });
  } catch (err) { noShop(res, err); }
});

// ---------- product page (GET aur order error dono isi se render) ----------
async function loadProduct(shopSlug, productSlug) {
  const shop = await S.getShopBySlug(shopSlug);
  if (!shop) return {};
  const p = (await pool.query('SELECT * FROM products WHERE shop_id = $1 AND slug = $2', [shop.id, String(productSlug || '').slice(0, 90)])).rows[0];
  return { shop, product: p || null };
}

async function renderProduct(req, res, shop, product, { error = null, form = null, code = 200 } = {}) {
  const me = req.session.user;
  const mine = !!(me && (me.id === shop.owner_id || me.role === 'admin'));
  const images = (await pool.query('SELECT image_id FROM product_images WHERE product_id = $1 ORDER BY position, image_id', [product.id])).rows.map((r) => r.image_id);
  const related = (await pool.query(
    `SELECT ${S.CARD_COLS} FROM products p JOIN shops s ON s.id = p.shop_id
     WHERE p.shop_id = $1 AND p.id <> $2 AND p.is_active = true ORDER BY (p.stock > 0) DESC, p.created_at DESC LIMIT 4`, [shop.id, product.id])).rows;

  let f = form;
  if (!f) {
    f = { qty: 1, name: '', phone: '', city: shop.city || '', address: '', note: '', method: shop.cod_enabled ? 'cod' : 'whatsapp' };
    if (me) { // pichle order se bhar do
      try {
        const last = (await pool.query('SELECT customer_name, phone, city, address FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [me.id])).rows[0];
        if (last) f = { ...f, name: last.customer_name, phone: S.showPhone(last.phone), city: last.city, address: last.address };
      } catch (e) { /* ignore */ }
    }
  }
  const base = S.baseUrlOf(req);
  const url = `${base}/shop/${shop.slug}/${product.slug}`;
  const soldOut = product.stock <= 0;
  const desc = (product.description || '').replace(/\s+/g, ' ').slice(0, 160) || `${product.name} - Rs ${S.rs(product.price_rs)}. ${shop.name}`;
  const ld = [{
    '@context': 'https://schema.org', '@type': 'Product', name: product.name, description: desc,
    image: images.map((id) => `${base}/img/${id}`), url,
    brand: { '@type': 'Brand', name: shop.name },
    offers: { '@type': 'Offer', priceCurrency: 'PKR', price: product.price_rs, url,
      availability: soldOut ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock' },
  }];
  res.status(code).render('shop-product', {
    title: `${product.name} - Rs ${S.rs(product.price_rs)} | ${shop.name}`,
    metaDescription: desc,
    ogImage: images[0] ? `${base}/img/${images[0]}` : undefined,
    ogImageCard: false, ogUrl: url, ogType: 'website',
    jsonLd: product.is_active && shop.status === 'active' ? ld : [],
    robots: product.is_active && shop.status === 'active' ? null : 'noindex,nofollow',
    shop, product, images, related, mine, f, error, soldOut,
    delivery: S.deliveryFor(shop, product.price_rs), rs: S.rs, MAX_QTY: S.MAX_QTY, shareUrl: url,
    lastStock: !soldOut && product.stock <= 5,
  });
}

router.get('/shop/:shop/:product', async (req, res) => {
  try {
    const { shop, product } = await loadProduct(req.params.shop, req.params.product);
    if (!shop || !product) return notFound(res, 'Ye product nahi mila.');
    const me = req.session.user;
    const mine = !!(me && (me.id === shop.owner_id || me.role === 'admin'));
    if ((!product.is_active || shop.status !== 'active') && !mine) return notFound(res, 'Ye product abhi available nahi.');
    if (product.is_active && shop.status === 'active') await S.trackProductVisit(req, res, product, shop); // cookie render se pehle
    await renderProduct(req, res, shop, product);
  } catch (err) { noShop(res, err); }
});

// ---------- POST /order ----------
router.post('/order', async (req, res) => {
  try {
    const b = req.body || {};
    const pid = S.toId(b.product_id);
    if (!pid) return notFound(res);
    const product = (await pool.query('SELECT * FROM products WHERE id = $1', [pid])).rows[0];
    if (!product) return notFound(res, 'Ye product nahi mila.');
    const shop = (await pool.query('SELECT * FROM shops WHERE id = $1', [product.shop_id])).rows[0];
    if (!shop || shop.status !== 'active' || !product.is_active) return notFound(res, 'Ye product abhi available nahi.');

    const me = req.session.user;
    const qty = Math.max(1, Math.min(S.MAX_QTY, parseInt(b.qty, 10) || 1));
    const f = {
      qty,
      name: S.oneLine(b.name, 80),
      phone: S.oneLine(b.phone, 20),
      city: S.oneLine(b.city, 60),
      address: S.multiLine(b.address, 300).replace(/\n/g, ', '),
      note: S.oneLine(b.note, 300),
      method: b.method === 'whatsapp' ? 'whatsapp' : 'cod',
    };
    const fail = (m, code = 400) => renderProduct(req, res, shop, product, { error: m, form: f, code });

    if (b.website) return res.redirect(`/shop/${shop.slug}/${product.slug}`); // honeypot (bots)
    if (f.method === 'cod' && !shop.cod_enabled) return fail('Is shop mein Cash on Delivery band hai.');
    if (f.method === 'whatsapp' && !(shop.wa_enabled && shop.whatsapp)) return fail('Is shop mein WhatsApp order band hai.');
    if (f.name.length < 3) return fail('Apna poora naam likhein (kam az kam 3 huroof).');
    const phone = S.cleanPhone(f.phone);
    if (!phone) return fail('Sahi phone number likhein, jaise 0300 1234567.');
    if (f.city.length < 2) return fail('Shehar ka naam likhein.');
    if (f.address.length < 10) return fail('Poora pata likhein (ghar / gali / mohalla), taake rider tak pahunch sake.');
    if (product.stock <= 0) return fail('Ye product Sold out ho chuka hai.', 409);
    if (qty > product.stock) return fail(`Sirf ${product.stock} bache hain. Kam quantity likhein.`, 409);

    // Double click: wohi phone, wohi product, 2 minute ke andar -> pehla order dikha do
    const dup = (await pool.query(
      `SELECT token FROM orders WHERE product_id = $1 AND phone = $2 AND created_at > now() - interval '2 minutes' ORDER BY id DESC LIMIT 1`,
      [product.id, phone])).rows[0];
    if (dup) return res.redirect('/order/' + dup.token);

    const attr = S.attrFor(req, product.id);
    const result = await S.placeOrder({
      shop, product, qty, f: { ...f, phone }, method: f.method, attr,
      visitor: visitorId(req, res), userId: me ? me.id : null,
    });
    if (result.error === 'soldout') return fail('Maaf kijiye, abhi abhi ye product Sold out ho gaya.', 409);

    // Seller ko khabar (in-app + email agar SMTP set ho)
    notifyUser(shop.owner_id,
      `🛒 Naya order #${result.id}: ${product.name} x ${qty} (${f.city}) - ${f.method === 'cod' ? 'Cash on Delivery' : 'WhatsApp'}`,
      '/seller/orders', { email: true, emailSubject: `Naya order #${result.id} - ${shop.name}` }).catch(() => {});

    res.redirect('/order/' + result.token + '?new=1');
  } catch (err) { noShop(res, err); }
});

// ---------- customer ka order page ----------
router.get('/order/:token', async (req, res) => {
  try {
    if (!/^[a-f0-9]{18}$/.test(req.params.token)) return notFound(res, 'Order nahi mila.');
    const o = (await pool.query(
      `SELECT o.*, s.name AS shop_name, s.slug AS shop_slug, s.whatsapp AS shop_whatsapp, s.phone AS shop_phone,
              p.slug AS product_slug, (SELECT pi.image_id FROM product_images pi WHERE pi.product_id = o.product_id ORDER BY pi.position LIMIT 1) AS image_id
       FROM orders o JOIN shops s ON s.id = o.shop_id LEFT JOIN products p ON p.id = o.product_id WHERE o.token = $1`, [req.params.token])).rows[0];
    if (!o) return notFound(res, 'Order nahi mila.');
    const wa = S.waOrderLink({ whatsapp: o.shop_whatsapp }, o, S.baseUrlOf(req));
    res.render('shop-order', {
      title: `Order #${o.id} - ${o.shop_name}`, robots: 'noindex,nofollow',
      o, wa, rs: S.rs, showPhone: S.showPhone,
      STATUS_LABEL: S.STATUS_LABEL, STATUSES: S.STATUSES, PAY_LABEL: S.PAY_LABEL,
      fresh: req.query.new === '1',
    });
  } catch (err) { noShop(res, err); }
});

module.exports = router;
