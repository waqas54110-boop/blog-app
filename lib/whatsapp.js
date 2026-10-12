// V56: Automatically send the customer a WhatsApp message after an order (Meta WhatsApp Cloud API).
//
// IMPORTANT: The first message to anyone on WhatsApp can only be sent via a "template" (a Meta-approved format).
// So .env needs WHATSAPP_TOKEN + WHATSAPP_PHONE_ID and Meta needs 2 templates (the text is in SETUP_V56.md).
// If these settings are missing nothing is sent: the order is still created, and the seller's order card keeps a ready
// "message the customer" WhatsApp button (wa.me link).
//
// Each kind of message is sent only once per order (UNIQUE (order_id, kind) in order_messages).
const pool = require('../db');
const config = require('../config');
const { nameOf } = require('./couriers');

const rs = (n) => Number(n || 0).toLocaleString('en-PK');
const enabled = () => !!(config.waToken && config.waPhoneId);
const orderUrl = (token) => (config.siteUrl ? config.siteUrl : '') + '/order/' + token;
const firstName = (n) => String(n || '').trim().split(/\s+/)[0].slice(0, 30) || 'Customer';

// WhatsApp template parameters cannot be empty or contain newlines
const param = (v) => ({ type: 'text', text: String(v == null || v === '' ? '-' : v).replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').slice(0, 200) });

function buildTemplate(kind, o, shopName) {
  const link = orderUrl(o.token);
  if (kind === 'placed') {
    return {
      name: config.waTplPlaced,
      // {{1}} name, {{2}} shop, {{3}} order #, {{4}} total amount, {{5}} number of days, {{6}} link
      params: [firstName(o.customer_name), shopName, o.id, rs(o.total_rs), config.orderEta, link],
    };
  }
  // dispatched / tracking: {{1}} name, {{2}} shop, {{3}} order #, {{4}} courier, {{5}} tracking number, {{6}} link
  return {
    name: config.waTplDispatched,
    params: [firstName(o.customer_name), shopName, o.id, o.courier ? nameOf(o.courier) || o.courier : 'seller\'s rider', o.tracking_no || 'not available yet', link],
  };
}

async function callApi(to, tpl) {
  const url = `https://graph.facebook.com/${config.waApiVersion}/${config.waPhoneId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.waToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: tpl.name,
        language: { code: config.waLang },
        components: [{ type: 'body', parameters: tpl.params.map(param) }],
      },
    }),
    signal: AbortSignal.timeout(10000),
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* body is not JSON */ }
  if (!res.ok) {
    const msg = data && data.error ? `${data.error.code || res.status}: ${data.error.message || ''}` : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// Send the message (or record "skipped" if disabled). Never throws: the order does not depend on it.
async function sendOrderMessage(orderId, kind) {
  try {
    const ins = await pool.query(
      `INSERT INTO order_messages (order_id, kind, channel, status) VALUES ($1, $2, 'whatsapp', 'pending')
       ON CONFLICT (order_id, kind) DO NOTHING RETURNING id`, [orderId, kind]);
    if (!ins.rows[0]) return { skipped: 'already' };
    const id = ins.rows[0].id;
    const set = (status, error) => pool.query('UPDATE order_messages SET status = $2, error = $3 WHERE id = $1', [id, status, error ? String(error).slice(0, 300) : null]);

    if (!enabled()) { await set('skipped', 'WhatsApp API not configured'); return { skipped: 'disabled' }; }

    const o = (await pool.query(
      `SELECT o.*, s.name AS shop_name FROM orders o JOIN shops s ON s.id = o.shop_id WHERE o.id = $1`, [orderId])).rows[0];
    if (!o) { await set('failed', 'order not found'); return { error: 'missing' }; }
    if (!/^92\d{10}$/.test(o.phone || '')) { await set('failed', 'invalid phone number'); return { error: 'phone' }; }

    try {
      await callApi(o.phone, buildTemplate(kind, o, o.shop_name));
      await set('sent');
      return { ok: true };
    } catch (err) {
      await set('failed', err.message);
      console.error(`[whatsapp] order #${orderId} (${kind}):`, err.message);
      return { error: err.message };
    }
  } catch (err) {
    console.error('[whatsapp] fail:', err.message);
    return { error: err.message };
  }
}

// For the seller's order card: {placed: {status, error}, dispatched: {...}, tracking: {...}} (keyed by order id)
async function statusMap(orderIds) {
  const map = {};
  if (!orderIds.length) return map;
  try {
    const r = await pool.query('SELECT order_id, kind, status, error FROM order_messages WHERE order_id = ANY($1::int[])', [orderIds]);
    r.rows.forEach((m) => { (map[m.order_id] = map[m.order_id] || {})[m.kind] = { status: m.status, error: m.error }; });
  } catch (err) { if (err.code !== '42P01') console.error('[whatsapp] statusMap:', err.message); }
  return map;
}

// If the auto message is disabled (or fails), the seller can open this ready-made wa.me link and send it manually
function manualLink(kind, o, shopName, base) {
  const link = (base || '') + '/order/' + o.token;
  const name = firstName(o.customer_name);
  const text = kind === 'placed'
    ? `Hello ${name}! We have received your order #${o.id} at ${shopName}. Total: Rs ${rs(o.total_rs)}. It should reach you in ${config.orderEta}.\nOrder status: ${link}`
    : `Hello ${name}! ${shopName}: your order #${o.id} has been shipped.`
      + (o.tracking_no ? `\nCourier: ${o.courier ? nameOf(o.courier) || o.courier : 'courier'}, tracking number: ${o.tracking_no}` : '')
      + `\nOrder status: ${link}`;
  return `https://wa.me/${o.phone}?text=${encodeURIComponent(text)}`;
}

module.exports = { enabled, sendOrderMessage, statusMap, manualLink };
