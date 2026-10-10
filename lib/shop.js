// Shop (V46): multi-vendor. Har user apni shop khol sakta hai; products, orders (COD / WhatsApp),
// group-wise sales. Is file mein shared helpers hain; routes/shop.js (public) aur routes/seller.js (seller panel) inhein use karte hain.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../db');
const config = require('../config');
const { slugify } = require('./slug');
const { detectSource, isBot, logBot, isIgnored } = require('./analytics');
const { parseUA } = require('./ua');
const ipinfo = require('./ipinfo');
const { visitorId, clientIp, geoCity, geoCountry } = require('./demographics');
const { notifyUser } = require('./notify');
const wa = require('./whatsapp');

const STATUSES = ['new', 'shipped', 'delivered', 'returned'];
const STATUS_LABEL = { new: 'Naya', shipped: 'Bhej diya', delivered: 'Pahunch gaya', returned: 'Wapas' };
const STATUS_COLOR = { new: '#f59e0b', shipped: '#3b82f6', delivered: '#12a37f', returned: '#dc3545' };
const PAY_LABEL = { cod: 'Cash on Delivery', whatsapp: 'WhatsApp order' };
const PLATFORMS = ['whatsapp', 'facebook', 'telegram', 'instagram', 'other'];
const CATEGORIES = ['Clothes', 'Shoes', 'Bags', 'Beauty', 'Electronics', 'Mobile accessories', 'Home & kitchen', 'Grocery', 'Kids', 'Books', 'Jewellery', 'Handmade', 'Other'];

const MAX_PRODUCT_PHOTOS = 4;
const MAX_QTY = 10;
const ATTR_DAYS = 7;

const oneLine = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const multiLine = (v, max) => String(v || '').replace(/\r/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const toId = (v) => (/^\d{1,9}$/.test(String(v)) ? parseInt(v, 10) : null);
const toRs = (v) => {
  const s = String(v == null ? '' : v).replace(/[,\s]/g, '');
  if (!/^\d{1,8}$/.test(s)) return null;
  return parseInt(s, 10);
};
const rs = (n) => Number(n || 0).toLocaleString('en-PK');

// Pakistani number: 0300-1234567 -> 923001234567. Khali = ''. Galat = null.
function cleanPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '92' + d.slice(1);
  return /^92\d{10}$/.test(d) ? d : null;
}
const showPhone = (p) => (/^92\d{10}$/.test(p || '') ? '0' + p.slice(2) : p || '');

// ---------- schema (migration_v46.sql + migration_v56.sql server start par khud chalti hain; dobara chalana safe) ----------
async function ensureSchema() {
  for (const file of ['migration_v46.sql', 'migration_v56.sql']) {
    try {
      const sql = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      await pool.query(sql);
    } catch (err) {
      console.error(`[shop] ${file} khud nahi chali (Neon SQL Editor mein haath se chalao):`, err.message);
    }
  }
}

// ---------- slugs ----------
async function uniqueShopSlug(wanted, excludeId = null) {
  const base = slugify(wanted).replace(/^post(-\d+)?$/, 'shop').slice(0, 50);
  let c = base;
  for (let n = 2; ; n++) {
    const r = await pool.query('SELECT 1 FROM shops WHERE slug = $1 AND ($2::int IS NULL OR id <> $2::int)', [c, excludeId]);
    if (r.rowCount === 0) return c;
    c = `${base}-${n}`;
  }
}
async function uniqueProductSlug(shopId, wanted, excludeId = null) {
  const base = slugify(wanted).replace(/^post(-\d+)?$/, 'item').slice(0, 70);
  let c = base;
  for (let n = 2; ; n++) {
    const r = await pool.query('SELECT 1 FROM products WHERE shop_id = $1 AND slug = $2 AND ($3::int IS NULL OR id <> $3::int)', [shopId, c, excludeId]);
    if (r.rowCount === 0) return c;
    c = `${base}-${n}`;
  }
}

// ---------- queries ----------
const MAIN_IMG = `(SELECT pi.image_id FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.position, pi.image_id LIMIT 1)`;
const CARD_COLS = `p.id, p.shop_id, p.slug, p.name, p.category, p.price_rs, p.compare_price_rs, p.stock, p.is_active, p.created_at,
  s.slug AS shop_slug, s.name AS shop_name, s.city AS shop_city, ${MAIN_IMG} AS image_id`;
const PUBLIC_WHERE = `p.is_active = true AND s.status = 'active'`;

const getMyShop = async (userId) => (await pool.query('SELECT * FROM shops WHERE owner_id = $1', [userId])).rows[0] || null;
const getShopBySlug = async (slug) => (await pool.query('SELECT * FROM shops WHERE slug = $1', [String(slug || '').slice(0, 60)])).rows[0] || null;

// Post ke neeche card ke liye (sirf live, bikne wali product)
async function productForPost(productId) {
  if (!productId) return null;
  const r = await pool.query(
    `SELECT ${CARD_COLS} FROM products p JOIN shops s ON s.id = p.shop_id WHERE p.id = $1 AND ${PUBLIC_WHERE}`, [productId]);
  return r.rows[0] || null;
}
// Editor ke dropdown ke liye
async function productsForSelect() {
  try {
    return (await pool.query(
      `SELECT p.id, p.name, s.name AS shop_name FROM products p JOIN shops s ON s.id = p.shop_id
       WHERE ${PUBLIC_WHERE} ORDER BY p.created_at DESC LIMIT 300`)).rows;
  } catch (err) { return []; }
}

// ---------- images ----------
// Browser ne /upload-feed-image se jo image upload ki, wo isi user ki ho aur kahin aur istemal na ho (ya isi product ki ho)
async function usableImage(imageId, userId, productId) {
  if (!imageId) return false;
  const r = await pool.query(
    `SELECT 1 FROM images i WHERE i.id = $1 AND i.uploaded_by = $2
       AND (
         (NOT EXISTS (SELECT 1 FROM feed_posts WHERE image_id = i.id)
          AND NOT EXISTS (SELECT 1 FROM stories WHERE image_id = i.id)
          AND NOT EXISTS (SELECT 1 FROM users WHERE avatar_image_id = i.id)
          AND NOT EXISTS (SELECT 1 FROM petitions WHERE image_id = i.id)
          AND NOT EXISTS (SELECT 1 FROM ads WHERE image_id = i.id)
          AND NOT EXISTS (SELECT 1 FROM product_images WHERE image_id = i.id)
          AND NOT EXISTS (SELECT 1 FROM shops WHERE logo_image_id = i.id))
         OR EXISTS (SELECT 1 FROM product_images WHERE image_id = i.id AND product_id = $3::int)
       )`, [imageId, userId, productId || null]);
  return r.rowCount > 0;
}

// ---------- attribution (group-wise sales) ----------
// Visitor product page par UTM ke saath aaya to session mein yaad rakho; order is se jud jata hai (7 din).
function rememberAttr(req, productId, a) {
  if (!req.session || !a || a.source === 'direct' || a.source === 'internal') return;
  const m = req.session.shopAttr && typeof req.session.shopAttr === 'object' ? req.session.shopAttr : {};
  m[productId] = { s: a.source, m: a.medium || null, c: a.campaign || null, t: Date.now() };
  const keys = Object.keys(m);
  if (keys.length > 20) keys.sort((x, y) => m[x].t - m[y].t).slice(0, keys.length - 20).forEach((k) => delete m[k]);
  req.session.shopAttr = m;
}
function attrFor(req, productId) {
  const a = req.session && req.session.shopAttr && req.session.shopAttr[productId];
  if (!a || Date.now() - a.t > ATTR_DAYS * 86400000) return { source: 'direct', medium: null, campaign: null };
  return { source: a.s, medium: a.m, campaign: a.c };
}

async function trackProductVisit(req, res, product, shop) {
  try {
    if (isBot(req)) { logBot(req); return; }
    if (isIgnored(req)) return; // admin ne is browser ko ignore kiya hai
    const a = detectSource(req);
    rememberAttr(req, product.id, a);
    const u = req.session && req.session.user;
    if (u && (u.role === 'admin' || u.id === shop.owner_id)) return; // apni shop / admin ke visits count nahi
    const vid = visitorId(req, res);
    const ip = clientIp(req);
    const city = geoCity(req);
    const country = geoCountry(req);
    const d = parseUA(req.get('User-Agent'));
    if (ip) ipinfo.enqueue(ip);
    try {
      // device / browser (migration_v55) pehle
      await pool.query(
        `INSERT INTO product_visits (product_id, shop_id, source, medium, campaign, referrer, visitor, ip, city, country, user_id, device, os, browser, brand, inapp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [product.id, shop.id, a.source, a.medium, a.campaign, a.referrer, vid, ip, city, country, u ? u.id : null, d.device, d.os, d.browser, d.brand, d.inapp]);
      return;
    } catch (err) {
      if (err.code !== '42703') throw err;
    }
    try {
      // ip / city / country / user (migration_v50) pehle; na ho to purani tarah visit ginein
      await pool.query(
        `INSERT INTO product_visits (product_id, shop_id, source, medium, campaign, referrer, visitor, ip, city, country, user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [product.id, shop.id, a.source, a.medium, a.campaign, a.referrer, vid, ip, city, country, u ? u.id : null]);
    } catch (err) {
      if (err.code !== '42703') throw err;
      await pool.query(
        `INSERT INTO product_visits (product_id, shop_id, source, medium, campaign, referrer, visitor)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [product.id, shop.id, a.source, a.medium, a.campaign, a.referrer, vid]);
    }
  } catch (err) {
    console.error('[shop] visit track:', err.message);
  }
}

// ---------- variants (V56) ----------
const variantLabel = (v) => [v.color, v.size, v.kind].filter(Boolean).join(' / ');
const variantsOf = async (productId) =>
  (await pool.query('SELECT * FROM product_variants WHERE product_id = $1 ORDER BY position, id', [productId])).rows;

// ---------- coupons (V56) ----------
const COUPON_SOURCES = ['tiktok', 'facebook', 'instagram', 'whatsapp', 'telegram', 'youtube', 'google'];
const cleanCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 30);
const findCoupon = async (shopId, code) => {
  const c = cleanCode(code);
  if (!c) return null;
  return (await pool.query('SELECT * FROM coupons WHERE shop_id = $1 AND code = $2', [shopId, c])).rows[0] || null;
};
// sources = visitor jin sources se in products par aaya (session attribution). only_source wale coupon ke liye zaroori.
function couponProblem(c, subtotal, sources) {
  if (!c || !c.is_active) return 'Ye coupon sahi nahi ya band hai.';
  if (c.expires_at && new Date(c.expires_at) <= new Date()) return 'Ye coupon expire ho chuka hai.';
  if (c.max_uses != null && c.used_count >= c.max_uses) return 'Is coupon ki limit poori ho chuki hai.';
  if (c.min_order_rs && subtotal < c.min_order_rs) return `Ye coupon Rs ${rs(c.min_order_rs)} se upar ke order par chalta hai.`;
  if (c.only_source && !(sources && sources.has(c.only_source))) return `Ye coupon sirf ${c.only_source} se aane walon ke liye hai.`;
  return null;
}
const couponDiscount = (c, subtotal) =>
  Math.max(0, Math.min(subtotal, c.kind === 'flat' ? c.value : Math.floor((subtotal * Math.min(c.value, 100)) / 100)));
const couponText = (c) => (c.kind === 'flat' ? `Rs ${rs(c.value)} off` : `${c.value}% off`);

// ---------- social proof (V56): sirf ASLI ginti ----------
// views  = aaj (site ke timezone mein) kitne alag visitors ne product dekha (apni shop / admin / bots ke visits ginti mein nahi aate).
// orders = kitne orders mein ye product hai (wapas aaye orders nahi ginte).
// Ginti config.proofMinViews / proofMinOrders se kam ho to 0 (line dikhayi nahi jati).
async function socialProof(productId) {
  try {
    const r = (await pool.query(
      `SELECT (SELECT COUNT(DISTINCT visitor)::int FROM product_visits
                WHERE product_id = $1 AND visitor IS NOT NULL
                  AND created_at >= (now() AT TIME ZONE $2::text)::date AT TIME ZONE $2::text) AS views,
              (SELECT COUNT(DISTINCT oi.order_id)::int FROM order_items oi JOIN orders o ON o.id = oi.order_id
                WHERE oi.product_id = $1 AND o.status <> 'returned') AS orders`,
      [productId, config.timezone])).rows[0];
    return {
      views: r.views >= config.proofMinViews ? r.views : 0,
      orders: r.orders >= config.proofMinOrders ? r.orders : 0,
    };
  } catch (err) {
    if (err.code !== '42P01') console.error('[shop] social proof:', err.message);
    return { views: 0, orders: 0 };
  }
}

// ---------- orders ----------
const deliveryFor = (shop, subtotal) =>
  (shop.free_over_rs && subtotal >= shop.free_over_rs) ? 0 : (shop.delivery_fee_rs || 0);

const summaryName = (items) => {
  const first = items[0];
  const base = first.product_name + (first.variant_label ? ` (${first.variant_label})` : '');
  return (items.length > 1 ? `${base} +${items.length - 1} aur` : base).slice(0, 120);
};

// groups: [{ shop, lines: [{ product, variant|null, qty }], coupon|null }]  (har shop ka alag order banta hai)
// Sab kuch ek hi transaction mein: stock ghate, coupon ginti barhe, orders + items likhein. Koi bhi cheez sold out ho
// to kuch bhi nahi banta. Do log aakhri piece ek saath order nahi kar sakte.
// Return: { orders: [{ id, token, shop, total_rs, discount_rs, summary }] } ya { error: 'soldout'|'coupon', name|code }
async function placeOrders({ groups, f, method, visitor, userId, attrOf }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Stock: saari cheezein ek hi tarteeb (product id, variant id) mein, taake do carts ek doosre ko na atkayein (deadlock)
    const flat = [];
    groups.forEach((g, gi) => g.lines.forEach((l) => flat.push({ gi, l })));
    flat.sort((x, y) => x.l.product.id - y.l.product.id
      || (x.l.variant ? x.l.variant.id : 0) - (y.l.variant ? y.l.variant.id : 0));

    const items = groups.map(() => []);
    for (const { gi, l } of flat) {
      let unit; let label = null; let variantId = null; let name;
      if (l.variant) {
        const uv = await client.query(
          `UPDATE product_variants SET stock = stock - $3
            WHERE id = $1 AND product_id = $2 AND stock >= $3 RETURNING id, price_rs, color, size, kind`,
          [l.variant.id, l.product.id, l.qty]);
        if (!uv.rows[0]) { await client.query('ROLLBACK'); return { error: 'soldout', name: `${l.product.name} (${variantLabel(l.variant)})` }; }
        // products.stock = variants ka jama (hamesha sahi rakhte hain)
        const up = await client.query(
          `UPDATE products SET stock = (SELECT COALESCE(SUM(v.stock), 0) FROM product_variants v WHERE v.product_id = products.id),
                               updated_at = now()
            WHERE id = $1 AND is_active = true RETURNING price_rs, name`, [l.product.id]);
        if (!up.rows[0]) { await client.query('ROLLBACK'); return { error: 'soldout', name: l.product.name }; }
        unit = uv.rows[0].price_rs != null ? uv.rows[0].price_rs : up.rows[0].price_rs;
        label = variantLabel(uv.rows[0]);
        variantId = uv.rows[0].id;
        name = up.rows[0].name;
      } else {
        const up = await client.query(
          `UPDATE products SET stock = stock - $2, updated_at = now()
            WHERE id = $1 AND is_active = true AND stock >= $2 RETURNING price_rs, name`, [l.product.id, l.qty]);
        if (!up.rows[0]) { await client.query('ROLLBACK'); return { error: 'soldout', name: l.product.name }; }
        unit = up.rows[0].price_rs;
        name = up.rows[0].name;
      }
      items[gi].push({ product_id: l.product.id, variant_id: variantId, product_name: name, variant_label: label, unit_price_rs: unit, qty: l.qty });
    }

    const made = [];
    for (let gi = 0; gi < groups.length; gi++) {
      const { shop, coupon } = groups[gi];
      const its = items[gi];
      const sub = its.reduce((a, it) => a + it.unit_price_rs * it.qty, 0);
      let discount = 0; let couponId = null; let couponCode = null;
      if (coupon) {
        const cu = await client.query(
          `UPDATE coupons SET used_count = used_count + 1
            WHERE id = $1 AND shop_id = $2 AND is_active = true
              AND (expires_at IS NULL OR expires_at > now()) AND (max_uses IS NULL OR used_count < max_uses)
           RETURNING id, code, kind, value, min_order_rs`, [coupon.id, shop.id]);
        if (!cu.rows[0] || sub < cu.rows[0].min_order_rs) { await client.query('ROLLBACK'); return { error: 'coupon', code: coupon.code }; }
        discount = couponDiscount(cu.rows[0], sub);
        couponId = cu.rows[0].id;
        couponCode = cu.rows[0].code;
      }
      const delivery = deliveryFor(shop, sub); // free-delivery ki hadd coupon se pehle ke jama par
      const total = sub - discount + delivery;
      const attr = attrOf ? attrOf(groups[gi]) : { source: 'direct', medium: null, campaign: null };
      const token = crypto.randomBytes(9).toString('hex');
      const summary = summaryName(its);
      const ins = await client.query(
        `INSERT INTO orders (token, shop_id, product_id, product_name, unit_price_rs, qty, delivery_rs, total_rs,
                             customer_name, phone, city, address, note, payment_method, user_id, source, medium, campaign, visitor,
                             coupon_id, coupon_code, discount_rs)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING id, token`,
        [token, shop.id, its[0].product_id, summary, its[0].unit_price_rs, its.reduce((a, it) => a + it.qty, 0), delivery, total,
         f.name, f.phone, f.city, f.address, f.note || null, method, userId || null,
         attr.source, attr.medium, attr.campaign, visitor, couponId, couponCode, discount]);
      for (const it of its) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, variant_id, product_name, variant_label, unit_price_rs, qty)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [ins.rows[0].id, it.product_id, it.variant_id, it.product_name, it.variant_label, it.unit_price_rs, it.qty]);
      }
      made.push({ id: ins.rows[0].id, token: ins.rows[0].token, shop, total_rs: total, discount_rs: discount, summary });
    }
    await client.query('COMMIT');
    return { orders: made };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

// Orders ke saath unki cheezein jod do (o.items). Purane orders migration_v56 se order_items mein aa chuke hain.
async function attachItems(orders) {
  if (!orders.length) return orders;
  const rows = (await pool.query(
    `SELECT oi.*, p.slug AS product_slug FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ANY($1::int[]) ORDER BY oi.id`, [orders.map((o) => o.id)])).rows;
  const by = {};
  rows.forEach((r) => { (by[r.order_id] = by[r.order_id] || []).push(r); });
  orders.forEach((o) => {
    o.items = by[o.id] || [{ product_name: o.product_name, variant_label: null, unit_price_rs: o.unit_price_rs, qty: o.qty, product_slug: null }];
    o.subtotal_rs = o.items.reduce((a, it) => a + it.unit_price_rs * it.qty, 0);
  });
  return orders;
}

// Status badalna. "Wapas" par stock ek hi dafa wapas judta hai (har cheez ka, variant samet); Wapas ke baad status band (final).
async function setOrderStatus(shopId, orderId, status) {
  if (!STATUSES.includes(status)) return null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = (await client.query('SELECT * FROM orders WHERE id = $1 AND shop_id = $2 FOR UPDATE', [orderId, shopId])).rows[0];
    if (!cur || cur.status === status || cur.status === 'returned') { await client.query('ROLLBACK'); return cur && cur.status === status ? cur : null; }
    await client.query(
      `UPDATE orders SET status = $2, updated_at = now(),
              shipped_at = CASE WHEN $2 = 'shipped' THEN COALESCE(shipped_at, now()) ELSE shipped_at END
        WHERE id = $1`, [orderId, status]);
    if (status === 'returned' && !cur.restocked) {
      const its = (await client.query('SELECT product_id, variant_id, qty FROM order_items WHERE order_id = $1', [orderId])).rows;
      for (const it of its) {
        if (!it.product_id) continue;
        if (it.variant_id) {
          await client.query('UPDATE product_variants SET stock = stock + $2 WHERE id = $1', [it.variant_id, it.qty]);
          await client.query(
            `UPDATE products SET stock = (SELECT COALESCE(SUM(v.stock), 0) FROM product_variants v WHERE v.product_id = products.id),
                                 updated_at = now() WHERE id = $1`, [it.product_id]);
        } else {
          await client.query('UPDATE products SET stock = stock + $2, updated_at = now() WHERE id = $1', [it.product_id, it.qty]);
        }
      }
      await client.query('UPDATE orders SET restocked = true WHERE id = $1', [orderId]);
    }
    await client.query('COMMIT');
    return { ...cur, status };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

// Customer ka WhatsApp message (shop ko order bhejne ke liye). o.items attachItems se aati hain.
function waOrderLink(shop, o, base) {
  if (!shop.whatsapp) return null;
  const items = o.items && o.items.length ? o.items : [{ product_name: o.product_name, variant_label: null, qty: o.qty }];
  const lines = [
    'Assalam o Alaikum! Main ne order kiya hai.',
    `Order #${o.id}`,
    ...items.map((it) => `Product: ${it.product_name}${it.variant_label ? ' (' + it.variant_label + ')' : ''} x ${it.qty}`),
  ];
  if (o.discount_rs) lines.push(`Coupon ${o.coupon_code || ''}: Rs ${rs(o.discount_rs)} chhoot`.replace('  ', ' '));
  lines.push(
    `Total: Rs ${rs(o.total_rs)}` + (o.delivery_rs ? ` (delivery Rs ${rs(o.delivery_rs)} shamil)` : ''),
    `Naam: ${o.customer_name}`,
    `Phone: ${showPhone(o.phone)}`,
    `Shehar: ${o.city}`,
    `Pata: ${o.address}`,
    `Payment: ${PAY_LABEL[o.payment_method] || o.payment_method}`,
  );
  if (base) lines.push(`${base}/order/${o.token}`);
  return `https://wa.me/${shop.whatsapp}?text=${encodeURIComponent(lines.join('\n'))}`;
}

// ---------- order form (product page aur cart ka ek hi form) ----------
function readOrderForm(b) {
  return {
    name: oneLine(b.name, 80),
    phone: oneLine(b.phone, 20),
    city: oneLine(b.city, 60),
    address: multiLine(b.address, 300).replace(/\n/g, ', '),
    note: oneLine(b.note, 300),
    method: b.method === 'whatsapp' ? 'whatsapp' : 'cod',
    coupon: cleanCode(b.coupon),
  };
}
// shops: jin shops ke order ban rahe hain. Return: error string ya null (sahi ho to f.phoneClean bhar jata hai)
function checkOrderForm(f, shops) {
  const many = shops.length > 1;
  for (const shop of shops) {
    const tag = many ? ` (${shop.name})` : '';
    if (f.method === 'cod' && !shop.cod_enabled) return 'Is shop mein Cash on Delivery band hai.' + tag;
    if (f.method === 'whatsapp' && !(shop.wa_enabled && shop.whatsapp)) return 'Is shop mein WhatsApp order band hai.' + tag;
  }
  if (f.name.length < 3) return 'Apna poora naam likhein (kam az kam 3 huroof).';
  const phone = cleanPhone(f.phone);
  if (!phone) return 'Sahi phone number likhein, jaise 0300 1234567.';
  f.phoneClean = phone;
  if (f.city.length < 2) return 'Shehar ka naam likhein.';
  if (f.address.length < 10) return 'Poora pata likhein (ghar / gali / mohalla), taake rider tak pahunch sake.';
  return null;
}
// Order ban jane ke baad: seller ko khabar + customer ko WhatsApp message (band ho to whatsapp.js khud skip kar deta hai).
// Dono "bhej kar bhool jao" hain: inke fail hone se order par koi asar nahi.
function afterOrdersPlaced(orders, f) {
  for (const o of orders) {
    notifyUser(o.shop.owner_id,
      `🛒 Naya order #${o.id}: ${o.summary} (${f.city}) - ${f.method === 'cod' ? 'Cash on Delivery' : 'WhatsApp'}`,
      '/seller/orders', { email: true, emailSubject: `Naya order #${o.id} - ${o.shop.name}` }).catch(() => {});
    wa.sendOrderMessage(o.id, 'placed').catch(() => {});
  }
  lowStockAlert(orders).catch(() => {});
}

// Stock kam hone par seller ko khabar: sirf tab jab is order se stock LOW_STOCK se neeche utra (pehle upar tha), taake baar baar na aaye.
const LOW_STOCK = 3;
async function lowStockAlert(orders) {
  for (const o of orders) {
    try {
      const rows = (await pool.query(
        `SELECT oi.product_name, oi.variant_label, oi.qty, COALESCE(v.stock, p.stock) AS stock
           FROM order_items oi
           LEFT JOIN products p ON p.id = oi.product_id
           LEFT JOIN product_variants v ON v.id = oi.variant_id
          WHERE oi.order_id = $1`, [o.id])).rows;
      const low = rows.filter((r) => r.stock != null && r.stock <= LOW_STOCK && r.stock + r.qty > LOW_STOCK);
      if (!low.length) continue;
      const text = low.map((r) => `${r.product_name}${r.variant_label ? ' (' + r.variant_label + ')' : ''}: ${r.stock === 0 ? 'Sold out ho gaya' : 'sirf ' + r.stock + ' bacha'}`).join(', ');
      await notifyUser(o.shop.owner_id, `⚠️ Stock kam: ${text}`, '/seller/products');
    } catch (err) { console.error('[shop] low stock alert:', err.message); }
  }
}

const baseUrlOf = (req) => config.siteUrl || `${req.protocol}://${req.get('host')}`;

module.exports = {
  STATUSES, STATUS_LABEL, STATUS_COLOR, PAY_LABEL, PLATFORMS, CATEGORIES, MAX_PRODUCT_PHOTOS, MAX_QTY, COUPON_SOURCES,
  oneLine, multiLine, toId, toRs, rs, cleanPhone, showPhone, ensureSchema,
  uniqueShopSlug, uniqueProductSlug, CARD_COLS, PUBLIC_WHERE, MAIN_IMG,
  getMyShop, getShopBySlug, productForPost, productsForSelect, usableImage,
  rememberAttr, attrFor, trackProductVisit, deliveryFor, placeOrders, attachItems, setOrderStatus, waOrderLink, baseUrlOf,
  readOrderForm, checkOrderForm, afterOrdersPlaced, lowStockAlert,
  variantLabel, variantsOf, cleanCode, findCoupon, couponProblem, couponDiscount, couponText, socialProof, summaryName,
};
