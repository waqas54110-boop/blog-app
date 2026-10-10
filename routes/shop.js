// Shop (V46) public side: /shop (sab products), /shop/:shop (ek shop), /shop/:shop/:product (product page + order form),
// POST /order (Cash on Delivery / WhatsApp), GET /order/:token (customer ka order page).
const express = require('express');
const pool = require('../db');
const config = require('../config');
const S = require('../lib/shop');
const { visitorId } = require('../lib/demographics');
const shopwall = require('../lib/shopwall');
const { isBot } = require('../lib/analytics');
const couriers = require('../lib/couriers');

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

  const variants = await S.variantsOf(product.id);
  const proof = await S.socialProof(product.id);

  let f = form;
  if (!f) {
    f = { qty: 1, name: '', phone: '', city: shop.city || '', address: '', note: '', method: shop.cod_enabled ? 'cod' : 'whatsapp', variant: '', coupon: req.session.cartCoupon || '' };
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
    shop, product, images, related, mine, f, error, soldOut, variants, proof,
    variantRows: variants.map((v) => ({ id: v.id, label: S.variantLabel(v), price: v.price_rs != null ? v.price_rs : product.price_rs, stock: v.stock })),
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
    // V52: login na kiya hua visitor ko sirf pehla hissa; signup ke baad isi product par wapas
    let wall = false;
    if (product.is_active && shop.status === 'active' && shopwall.shouldWall(req, res, isBot)) {
      wall = true;
      req.session.returnTo = `/shop/${shop.slug}/${product.slug}`;
      req.session.fbWallPost = product.name;
      req.session.wallKind = 'shop';
      res.locals.wallDesc = shopwall.teaser(product.description, config.shopWallChars);
    }
    res.locals.shopWall = wall;
    if (req.query.coupon) req.session.cartCoupon = S.cleanCode(req.query.coupon); // ?coupon=TIKTOK10 wale link
    await renderProduct(req, res, shop, product, { error: req.query.cart_error ? String(req.query.cart_error).slice(0, 200) : null });
  } catch (err) { noShop(res, err); }
});

// ---------- TikTok ----------
// Chhota link (TikTok bio mein): /tp/12 -> product page, source = tiktok (orders analytics mein "tiktok" dikhte hain)
router.get('/tp/:id', async (req, res, next) => {
  try {
    const id = S.toId(req.params.id);
    if (!id) return next();
    const r = (await pool.query(
      `SELECT p.slug, s.slug AS shop_slug FROM products p JOIN shops s ON s.id = p.shop_id WHERE p.id = $1 AND p.is_active = true AND s.status = 'active'`, [id])).rows[0];
    if (!r) return notFound(res, 'Ye product abhi available nahi.');
    const camp = S.oneLine(req.query.c, 40).toLowerCase().replace(/[^a-z0-9_\-]/g, '');
    const cpn = S.cleanCode(req.query.coupon); // /tp/12?coupon=TIKTOK10
    res.redirect(302, `/shop/${r.shop_slug}/${r.slug}?utm_source=tiktok&utm_medium=bio` + (camp ? '&utm_campaign=' + camp : '') + (cpn ? '&coupon=' + cpn : ''));
  } catch (err) { noShop(res, err); }
});

// TikTok Video Studio (sirf shop owner / admin): browser mein hi 9:16, 60 second ki funny product video
router.get('/shop/:shop/:product/tiktok', async (req, res) => {
  try {
    const { shop, product } = await loadProduct(req.params.shop, req.params.product);
    if (!shop || !product) return notFound(res, 'Ye product nahi mila.');
    const me = req.session.user;
    const mine = !!(me && (me.id === shop.owner_id || me.role === 'admin'));
    if (!mine) return notFound(res, 'Ye page sirf shop owner ke liye hai.');
    const images = (await pool.query('SELECT image_id FROM product_images WHERE product_id = $1 ORDER BY position, image_id LIMIT 4', [product.id])).rows.map((r) => r.image_id);
    const base = S.baseUrlOf(req);
    const shortUrl = `${base}/tp/${product.id}`;
    const off = product.compare_price_rs && product.compare_price_rs > product.price_rs
      ? Math.round((product.compare_price_rs - product.price_rs) * 100 / product.compare_price_rs) : 0;
    const N = String(product.name || '').replace(/[^\p{L}\p{N}\s&'.-]/gu, '').replace(/\s+/g, ' ').trim() || 'this';
    const price = S.rs(product.price_rs);
    const cod = !!shop.cod_enabled;
    const caption = `${product.name} - Rs ${price} \u{1F525} ${cod ? 'Cash on Delivery! ' : ''}Link in bio \u{1F446}`;
    const slugTag = String(shop.name || 'shop').toLowerCase().replace(/[^a-z0-9]/g, '');
    const tags = `#shopping #pakistan #fyp #foryou #deal #viral #onlineshopping${cod ? ' #cod' : ''}${slugTag ? ' #' + slugTag : ''}`;
    const presets = [
      { key: 'wallet', label: '\u{1F4B8} Wallet cries',
        en: `Wait, wait, wait! Do not scroll! Meet ${N}. I know what you are thinking. I don't need it. But look at it. Really look at it. Gorgeous, right? My wallet said please don't. My heart said please do. And guess who won? The heart. Always the heart. Now here is the part where you sit down. It is only Rs ${price}. Yes, really! No, I am not joking. ${cod ? 'And you pay when it arrives, cash on delivery, so even your wallet can relax. ' : ''}Your friends will ask, where did you get that? And you will say, oh, this old thing? Just the best deal on the internet. But hurry, because it is selling fast, and I am not waiting around while you think about it. Tap the link in my bio, order now, and thank me later!` },
      { key: 'mom', label: '\u{1F469} Mom vs Me',
        en: `Mom: Do we really need ${N}? Me: Need? Mom, it needs me! Mom: What about the budget? Me: Mom, it is only Rs ${price}. That is basically free. Mom: Basically free is not free. Me: Fine, look at it. Just look. Mom: ...Okay, that is actually nice. Me: See? Now you want it too! ${cod ? 'And the best part, we pay when it arrives. Cash on delivery. No stress, no tension. ' : ''}Mom: Order two. Me: That is my mom! So if even my mom is convinced, what is stopping you? Hurry up, it is selling fast. Tap the link in my bio and order now, before Mom takes it all!` },
      { key: 'trailer', label: '\u{1F3AC} Movie trailer',
        en: `In a world full of boring things, one hero rises. ${N}. This summer, it is coming for your cart. Critics say, wow. Friends say, where did you get that? And your wallet says, here we go again. For only Rs ${price}, it can be yours. ${cod ? 'No card, no stress. Just cash on delivery. ' : ''}Do not miss the biggest deal of the season. Stock is limited, and the clock is ticking. Tick, tock, tick, tock. Rated T for totally worth it. Coming soon to your doorstep. Tap the link in my bio and order now!` },
    ];
    res.render('shop-tiktok', {
      title: 'TikTok video: ' + product.name, robots: 'noindex,nofollow',
      metaDescription: 'Make a 60-second funny TikTok video for this product.',
      shop, product, images, rs: S.rs, shortUrl, caption, tags, presets,
      studio: {
        id: product.id, name: String(product.name || ''), price: product.price_rs, compare: product.compare_price_rs || 0, off,
        stock: product.stock, shopName: String(shop.name || ''), cod, shortUrl,
        images: images.map((i) => '/img/' + i),
      },
    });
  } catch (err) { noShop(res, err); }
});

// ---------- POST /order (seedha order: ek product, ek variant) ----------
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
    const f = { ...S.readOrderForm(b), qty, variant: String(S.toId(b.variant_id) || '') };
    const fail = (m, code = 400) => renderProduct(req, res, shop, product, { error: m, form: f, code });

    if (b.website) return res.redirect(`/shop/${shop.slug}/${product.slug}`); // honeypot (bots)

    const variants = await S.variantsOf(product.id);
    let variant = null;
    if (variants.length) {
      variant = variants.find((v) => String(v.id) === f.variant) || null;
      if (!variant) return fail('Pehle rang / size chunein.');
    }
    const bad = S.checkOrderForm(f, [shop]);
    if (bad) return fail(bad);
    const avail = variant ? variant.stock : product.stock;
    if (avail <= 0) return fail(variant ? 'Ye option Sold out ho chuka hai.' : 'Ye product Sold out ho chuka hai.', 409);
    if (qty > avail) return fail(`Sirf ${avail} bache hain. Kam quantity likhein.`, 409);

    const attr = S.attrFor(req, product.id);
    let coupon = null;
    if (f.coupon) {
      const unit = variant && variant.price_rs != null ? variant.price_rs : product.price_rs;
      const row = await S.findCoupon(shop.id, f.coupon);
      const problem = row ? S.couponProblem(row, unit * qty, new Set([attr.source])) : 'Ye coupon sahi nahi ya is shop ka nahi.';
      if (problem) return fail(problem);
      coupon = row;
    }

    // Double click: wohi phone, wohi product, 2 minute ke andar -> pehla order dikha do
    const dup = (await pool.query(
      `SELECT token FROM orders WHERE product_id = $1 AND phone = $2 AND created_at > now() - interval '2 minutes' ORDER BY id DESC LIMIT 1`,
      [product.id, f.phoneClean])).rows[0];
    if (dup) return res.redirect('/order/' + dup.token);

    const result = await S.placeOrders({
      groups: [{ shop, coupon, lines: [{ product, variant, qty }] }],
      f: { ...f, phone: f.phoneClean }, method: f.method,
      visitor: visitorId(req, res), userId: me ? me.id : null, attrOf: () => attr,
    });
    if (result.error === 'soldout') return fail('Maaf kijiye, abhi abhi ye Sold out ho gaya.', 409);
    if (result.error === 'coupon') return fail('Ye coupon ab lag nahi sakta (limit poori ya expire). Hata kar dobara try karein.', 409);

    S.afterOrdersPlaced(result.orders, f); // seller ko khabar + customer ko WhatsApp message
    res.redirect('/order/' + result.orders[0].token + '?new=1');
  } catch (err) { noShop(res, err); }
});

// ---------- Mera order dhoondo (order number + phone se) ----------
router.get('/track', (req, res) => {
  res.render('shop-track', { title: 'Mera order dhoondo', robots: 'noindex,nofollow', error: null, f: { id: '', phone: '' } });
});
router.post('/track', async (req, res) => {
  try {
    const b = req.body || {};
    const f = { id: S.oneLine(b.id, 12).replace('#', ''), phone: S.oneLine(b.phone, 20) };
    const id = S.toId(f.id);
    const phone = S.cleanPhone(f.phone);
    const bad = (m) => res.status(400).render('shop-track', { title: 'Mera order dhoondo', robots: 'noindex,nofollow', error: m, f });
    if (!id || !phone) return bad('Order number (jaise 123) aur wohi phone number likhein jo order mein diya tha.');
    const o = (await pool.query('SELECT token FROM orders WHERE id = $1 AND phone = $2', [id, phone])).rows[0];
    if (!o) return bad('Is order number aur phone se koi order nahi mila. Dobara check karein.');
    res.redirect('/order/' + o.token);
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
    await S.attachItems([o]);
    const wa = S.waOrderLink({ whatsapp: o.shop_whatsapp }, o, S.baseUrlOf(req));
    const courier = o.courier
      ? { name: couriers.nameOf(o.courier) || o.courier, no: o.tracking_no, link: o.tracking_no ? couriers.trackLink(o.courier, o.tracking_no) : null }
      : null;
    res.render('shop-order', {
      title: `Order #${o.id} - ${o.shop_name}`, robots: 'noindex,nofollow',
      o, wa, courier, rs: S.rs, showPhone: S.showPhone,
      STATUS_LABEL: S.STATUS_LABEL, STATUSES: S.STATUSES, PAY_LABEL: S.PAY_LABEL,
      fresh: req.query.new === '1',
    });
  } catch (err) { noShop(res, err); }
});

module.exports = router;
