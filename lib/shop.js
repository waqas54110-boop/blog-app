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

// ---------- schema (migration_v46.sql server start par khud chal jati hai; dobara chalana safe) ----------
async function ensureSchema() {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migration_v46.sql'), 'utf8');
    await pool.query(sql);
  } catch (err) {
    console.error('[shop] migration_v46.sql khud nahi chali (Neon SQL Editor mein haath se chalao):', err.message);
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

// ---------- orders ----------
const deliveryFor = (shop, subtotal) =>
  (shop.free_over_rs && subtotal >= shop.free_over_rs) ? 0 : (shop.delivery_fee_rs || 0);

// Stock aur order ek hi transaction mein: do log aakhri piece ek saath order nahi kar sakte.
async function placeOrder({ shop, product, qty, f, method, attr, visitor, userId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const up = await client.query(
      `UPDATE products SET stock = stock - $2, updated_at = now()
       WHERE id = $1 AND is_active = true AND stock >= $2 RETURNING price_rs, name`, [product.id, qty]);
    if (!up.rows[0]) { await client.query('ROLLBACK'); return { error: 'soldout' }; }
    const unit = up.rows[0].price_rs;
    const sub = unit * qty;
    const delivery = deliveryFor(shop, sub);
    const token = crypto.randomBytes(9).toString('hex');
    const ins = await client.query(
      `INSERT INTO orders (token, shop_id, product_id, product_name, unit_price_rs, qty, delivery_rs, total_rs,
                           customer_name, phone, city, address, note, payment_method, user_id, source, medium, campaign, visitor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id, token`,
      [token, shop.id, product.id, up.rows[0].name, unit, qty, delivery, sub + delivery,
       f.name, f.phone, f.city, f.address, f.note || null, method, userId || null,
       attr.source, attr.medium, attr.campaign, visitor]);
    await client.query('COMMIT');
    return { id: ins.rows[0].id, token: ins.rows[0].token };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

// Status badalna. "Wapas" par stock ek hi dafa wapas judta hai; Wapas ke baad status band (final).
async function setOrderStatus(shopId, orderId, status) {
  if (!STATUSES.includes(status)) return null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = (await client.query('SELECT * FROM orders WHERE id = $1 AND shop_id = $2 FOR UPDATE', [orderId, shopId])).rows[0];
    if (!cur || cur.status === status || cur.status === 'returned') { await client.query('ROLLBACK'); return cur && cur.status === status ? cur : null; }
    await client.query('UPDATE orders SET status = $2, updated_at = now() WHERE id = $1', [orderId, status]);
    if (status === 'returned' && !cur.restocked) {
      if (cur.product_id) await client.query('UPDATE products SET stock = stock + $2, updated_at = now() WHERE id = $1', [cur.product_id, cur.qty]);
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

// Customer ka WhatsApp message (shop ko order bhejne ke liye)
function waOrderLink(shop, o, base) {
  if (!shop.whatsapp) return null;
  const lines = [
    'Assalam o Alaikum! Main ne order kiya hai.',
    `Order #${o.id}`,
    `Product: ${o.product_name} x ${o.qty}`,
    `Total: Rs ${rs(o.total_rs)}` + (o.delivery_rs ? ` (delivery Rs ${rs(o.delivery_rs)} shamil)` : ''),
    `Naam: ${o.customer_name}`,
    `Phone: ${showPhone(o.phone)}`,
    `Shehar: ${o.city}`,
    `Pata: ${o.address}`,
    `Payment: ${PAY_LABEL[o.payment_method] || o.payment_method}`,
  ];
  if (base) lines.push(`${base}/order/${o.token}`);
  return `https://wa.me/${shop.whatsapp}?text=${encodeURIComponent(lines.join('\n'))}`;
}

const baseUrlOf = (req) => config.siteUrl || `${req.protocol}://${req.get('host')}`;

module.exports = {
  STATUSES, STATUS_LABEL, STATUS_COLOR, PAY_LABEL, PLATFORMS, CATEGORIES, MAX_PRODUCT_PHOTOS, MAX_QTY,
  oneLine, multiLine, toId, toRs, rs, cleanPhone, showPhone, ensureSchema,
  uniqueShopSlug, uniqueProductSlug, CARD_COLS, PUBLIC_WHERE, MAIN_IMG,
  getMyShop, getShopBySlug, productForPost, productsForSelect, usableImage,
  rememberAttr, attrFor, trackProductVisit, deliveryFor, placeOrder, setOrderStatus, waOrderLink, baseUrlOf,
};
