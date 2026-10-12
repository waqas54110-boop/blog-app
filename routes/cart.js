// V56 Cart: /cart (view), /cart/add, /cart/update, /cart/remove, /cart/coupon, /cart/checkout (a separate order per shop), /cart/done.
const express = require('express');
const pool = require('../db');
const S = require('../lib/shop');
const Cart = require('../lib/cart');
const { visitorId } = require('../lib/demographics');

const router = express.Router();

const go = (res, path, msg, key = 'msg') => res.redirect(path + (msg ? (path.includes('?') ? '&' : '?') + key + '=' + encodeURIComponent(msg) : ''));
const fail500 = (res, err) => {
  if (err && (err.code === '42P01' || err.code === '42703')) {
    return res.status(503).render('404', { code: 503, title: 'Cart setup', message: 'The cart is being set up (migration_v56.sql). Please try again in a little while.' });
  }
  console.error(err);
  return res.status(500).send('Server error');
};

async function prefill(req) {
  const me = req.session.user;
  const f = { name: '', phone: '', city: '', address: '', note: '', method: 'cod' };
  if (me) {
    try {
      const last = (await pool.query('SELECT customer_name, phone, city, address FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [me.id])).rows[0];
      if (last) Object.assign(f, { name: last.customer_name, phone: S.showPhone(last.phone), city: last.city, address: last.address });
    } catch (e) { /* ignore */ }
  }
  return f;
}

async function renderCart(req, res, { error = null, msg = null, form = null, code = 200 } = {}) {
  const cart = await Cart.load(req);
  await Cart.price(req, cart, req.session.cartCoupon || '');
  const sug = await Cart.suggestions(cart, 4);
  const f = form || (await prefill(req));
  const shops = cart.groups.map((g) => g.shop);
  const codOk = shops.length > 0 && shops.every((s) => s.cod_enabled);
  const waOk = shops.length > 0 && shops.every((s) => s.wa_enabled && s.whatsapp);
  if (f.method === 'cod' && !codOk && waOk) f.method = 'whatsapp';
  if (f.method === 'whatsapp' && !waOk && codOk) f.method = 'cod';
  res.status(code).render('shop-cart', {
    title: 'My cart', robots: 'noindex,nofollow', noCartFab: true,
    cart, sug, f, error, msg, codOk, waOk, rs: S.rs, MAX_QTY: S.MAX_QTY, couponText: S.couponText,
    notices: [
      ...cart.dropped.map((n) => `"${n}" was removed from your cart (no longer available).`),
      ...cart.adjusted.map((n) => `The quantity of "${n}" was reduced to match the available stock.`),
    ],
  });
}

router.get('/cart', async (req, res) => {
  try {
    if (req.query.coupon) req.session.cartCoupon = S.cleanCode(req.query.coupon);
    await renderCart(req, res, {
      msg: req.query.msg ? String(req.query.msg).slice(0, 200) : null,
      error: req.query.error ? String(req.query.error).slice(0, 200) : null,
    });
  } catch (err) { fail500(res, err); }
});

// ---------- add to cart ----------
router.post('/cart/add', async (req, res) => {
  const b = req.body || {};
  const pid = S.toId(b.product_id);
  const vid = S.toId(b.variant_id) || 0;
  try {
    if (!pid) return go(res, '/cart', 'Product not found.', 'error');
    const p = (await pool.query(
      `SELECT p.*, s.slug AS shop_slug, s.status AS shop_status FROM products p JOIN shops s ON s.id = p.shop_id WHERE p.id = $1`, [pid])).rows[0];
    if (!p || !p.is_active || p.shop_status !== 'active') return go(res, '/cart', 'This product is not available right now.', 'error');
    const productPage = `/shop/${p.shop_slug}/${p.slug}`;
    const variants = await S.variantsOf(p.id);
    let avail = p.stock;
    if (variants.length) {
      const v = variants.find((x) => x.id === vid);
      if (!v) return go(res, productPage, 'Please choose a color / size first.', 'cart_error');
      avail = v.stock;
    }
    if (avail <= 0) return go(res, productPage, 'This option is sold out right now.', 'cart_error');
    const qty = Math.max(1, Math.min(S.MAX_QTY, parseInt(b.qty, 10) || 1));
    if (Cart.add(req, p.id, variants.length ? vid : 0, qty) === 'full') return go(res, '/cart', 'Your cart is full. Please remove an item first.', 'error');
    go(res, '/cart', `"${p.name.slice(0, 40)}" was added to your cart.`);
  } catch (err) { fail500(res, err); }
});

router.post('/cart/update', (req, res) => {
  const key = String((req.body || {}).key || '');
  if (/^\d+-\d+$/.test(key)) {
    const q = parseInt(req.body.qty, 10);
    if (Number.isInteger(q) && q >= 0) Cart.setQty(req, key, Math.min(q, S.MAX_QTY));
  }
  res.redirect('/cart');
});

router.post('/cart/remove', (req, res) => {
  const key = String((req.body || {}).key || '');
  if (/^\d+-\d+$/.test(key)) Cart.remove(req, key);
  res.redirect('/cart');
});

router.post('/cart/coupon', (req, res) => {
  req.session.cartCoupon = S.cleanCode((req.body || {}).code);
  res.redirect('/cart');
});

// ---------- place the order ----------
router.post('/cart/checkout', async (req, res) => {
  try {
    const b = req.body || {};
    if (b.website) return res.redirect('/cart'); // honeypot (bots)
    const f = S.readOrderForm(b);
    req.session.cartCoupon = f.coupon;
    const me = req.session.user;

    const cart = await Cart.load(req);
    if (!cart.groups.length) return go(res, '/cart', cart.dropped.length ? 'The items in your cart are no longer available.' : 'Your cart is empty.', 'error');
    await Cart.price(req, cart, f.coupon);
    const again = (m, status = 400) => renderCart(req, res, { error: m, form: f, code: status });

    if (cart.dropped.length || cart.adjusted.length) return again('Your cart changed because of stock. Please review it and confirm again.', 409);
    const bad = S.checkOrderForm(f, cart.groups.map((g) => g.shop));
    if (bad) return again(bad);
    if (f.coupon && !cart.couponApplied) return again(cart.couponError || 'This coupon could not be applied. Remove it and try again.');
    // A shop where the coupon does not apply (or has a problem) gets an order without the coupon; if there is a problem, tell the customer first
    const probs = cart.groups.filter((g) => g.couponProblem);
    if (probs.length) return again(`${probs[0].shop.name}: ${probs[0].couponProblem}`);

    // Double click: same phone, same shop, same items within 2 minutes -> show the earlier orders
    const dupTokens = [];
    for (const g of cart.groups) {
      const summary = S.summaryName(g.lines.map((l) => ({ product_name: l.product.name, variant_label: l.variantLabel })));
      const d = (await pool.query(
        `SELECT token FROM orders WHERE shop_id = $1 AND phone = $2 AND product_name = $3 AND created_at > now() - interval '2 minutes' ORDER BY id DESC LIMIT 1`,
        [g.shop.id, f.phoneClean, summary])).rows[0];
      if (d) dupTokens.push(d.token);
    }
    if (dupTokens.length === cart.groups.length) {
      Cart.clear(req);
      req.session.lastOrders = dupTokens;
      return res.redirect(dupTokens.length === 1 ? '/order/' + dupTokens[0] : '/cart/done');
    }

    const attrOf = (grp) => {
      for (const l of grp.lines) { const a = S.attrFor(req, l.product.id); if (a.source !== 'direct') return a; }
      return { source: 'direct', medium: null, campaign: null };
    };
    const result = await S.placeOrders({
      groups: cart.groups.map((g) => ({ shop: g.shop, coupon: g.coupon, lines: g.lines.map((l) => ({ product: l.product, variant: l.variant, qty: l.qty })) })),
      f: { ...f, phone: f.phoneClean }, method: f.method, visitor: visitorId(req, res), userId: me ? me.id : null, attrOf,
    });
    if (result.error === 'soldout') return again(`Sorry, "${result.name}" just sold out. Please review your cart again.`, 409);
    if (result.error === 'coupon') return again(`Coupon ${result.code} can no longer be applied (limit reached or expired). Remove it and try again.`, 409);

    S.afterOrdersPlaced(result.orders, f);
    Cart.clear(req);
    req.session.cartCoupon = '';
    req.session.lastOrders = result.orders.map((o) => o.token);
    res.redirect(result.orders.length === 1 ? '/order/' + result.orders[0].token + '?new=1' : '/cart/done');
  } catch (err) { fail500(res, err); }
});

// List of orders when several shops' orders were created together
router.get('/cart/done', async (req, res) => {
  try {
    const tokens = Array.isArray(req.session.lastOrders) ? req.session.lastOrders.filter((t) => /^[a-f0-9]{18}$/.test(t)) : [];
    if (!tokens.length) return res.redirect('/cart');
    const orders = (await pool.query(
      `SELECT o.*, s.name AS shop_name FROM orders o JOIN shops s ON s.id = o.shop_id WHERE o.token = ANY($1::text[]) ORDER BY o.id`, [tokens])).rows;
    await S.attachItems(orders);
    res.render('shop-cart-done', { title: 'Orders placed', robots: 'noindex,nofollow', noCartFab: true, orders, rs: S.rs });
  } catch (err) { fail500(res, err); }
});

module.exports = router;
