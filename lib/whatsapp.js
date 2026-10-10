// V56: Order ke baad customer ko WhatsApp message khud (Meta WhatsApp Cloud API).
//
// ZAROORI: WhatsApp par kisi ko pehla message "template" (Meta se manzoor-shuda format) ke zariye hi ja sakta hai.
// Is liye .env mein WHATSAPP_TOKEN + WHATSAPP_PHONE_ID aur Meta mein 2 templates chahiye (SETUP_V56.md mein text likha hai).
// Ye settings na hon to kuch bhi nahi bheja jata: order phir bhi ban jata hai, aur seller ke order card par
// "customer ko message bhejo" ka tayyar WhatsApp button rehta hai (wa.me link).
//
// Har order ka har kism ka message sirf ek baar jata hai (order_messages mein UNIQUE (order_id, kind)).
const pool = require('../db');
const config = require('../config');
const { nameOf } = require('./couriers');

const rs = (n) => Number(n || 0).toLocaleString('en-PK');
const enabled = () => !!(config.waToken && config.waPhoneId);
const orderUrl = (token) => (config.siteUrl ? config.siteUrl : '') + '/order/' + token;
const firstName = (n) => String(n || '').trim().split(/\s+/)[0].slice(0, 30) || 'Customer';

// WhatsApp template parameters khali / naye-line wale nahi ho sakte
const param = (v) => ({ type: 'text', text: String(v == null || v === '' ? '-' : v).replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').slice(0, 200) });

function buildTemplate(kind, o, shopName) {
  const link = orderUrl(o.token);
  if (kind === 'placed') {
    return {
      name: config.waTplPlaced,
      // {{1}} naam, {{2}} shop, {{3}} order #, {{4}} kul raqam, {{5}} kitne din, {{6}} link
      params: [firstName(o.customer_name), shopName, o.id, rs(o.total_rs), config.orderEta, link],
    };
  }
  // dispatched / tracking: {{1}} naam, {{2}} shop, {{3}} order #, {{4}} courier, {{5}} tracking number, {{6}} link
  return {
    name: config.waTplDispatched,
    params: [firstName(o.customer_name), shopName, o.id, o.courier ? nameOf(o.courier) || o.courier : 'seller ka rider', o.tracking_no || 'abhi available nahi', link],
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
  try { data = await res.json(); } catch (e) { /* body json nahi */ }
  if (!res.ok) {
    const msg = data && data.error ? `${data.error.code || res.status}: ${data.error.message || ''}` : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// Message bhejo (ya band ho to "skipped" likh do). Kabhi throw nahi karta: order ka kaam is par nahi rukta.
async function sendOrderMessage(orderId, kind) {
  try {
    const ins = await pool.query(
      `INSERT INTO order_messages (order_id, kind, channel, status) VALUES ($1, $2, 'whatsapp', 'pending')
       ON CONFLICT (order_id, kind) DO NOTHING RETURNING id`, [orderId, kind]);
    if (!ins.rows[0]) return { skipped: 'already' };
    const id = ins.rows[0].id;
    const set = (status, error) => pool.query('UPDATE order_messages SET status = $2, error = $3 WHERE id = $1', [id, status, error ? String(error).slice(0, 300) : null]);

    if (!enabled()) { await set('skipped', 'WhatsApp API set nahi'); return { skipped: 'disabled' }; }

    const o = (await pool.query(
      `SELECT o.*, s.name AS shop_name FROM orders o JOIN shops s ON s.id = o.shop_id WHERE o.id = $1`, [orderId])).rows[0];
    if (!o) { await set('failed', 'order nahi mila'); return { error: 'missing' }; }
    if (!/^92\d{10}$/.test(o.phone || '')) { await set('failed', 'phone number sahi nahi'); return { error: 'phone' }; }

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

// Seller ke order card ke liye: {placed: {status, error}, dispatched: {...}, tracking: {...}} (order id ke hisaab se)
async function statusMap(orderIds) {
  const map = {};
  if (!orderIds.length) return map;
  try {
    const r = await pool.query('SELECT order_id, kind, status, error FROM order_messages WHERE order_id = ANY($1::int[])', [orderIds]);
    r.rows.forEach((m) => { (map[m.order_id] = map[m.order_id] || {})[m.kind] = { status: m.status, error: m.error }; });
  } catch (err) { if (err.code !== '42P01') console.error('[whatsapp] statusMap:', err.message); }
  return map;
}

// Auto message band ho (ya fail ho jaye) to seller ye tayyar wa.me link khud khol kar bhej sakta hai
function manualLink(kind, o, shopName, base) {
  const link = (base || '') + '/order/' + o.token;
  const name = firstName(o.customer_name);
  const text = kind === 'placed'
    ? `Assalam o Alaikum ${name}! ${shopName} par aap ka order #${o.id} mil gaya hai. Kul raqam Rs ${rs(o.total_rs)}. Ye ${config.orderEta} mein pahunch jaye ga.\nOrder ki halat: ${link}`
    : `Assalam o Alaikum ${name}! ${shopName}: aap ka order #${o.id} bhej diya gaya hai.`
      + (o.tracking_no ? `\nCourier: ${o.courier ? nameOf(o.courier) || o.courier : 'courier'}, tracking number: ${o.tracking_no}` : '')
      + `\nOrder ki halat: ${link}`;
  return `https://wa.me/${o.phone}?text=${encodeURIComponent(text)}`;
}

module.exports = { enabled, sendOrderMessage, statusMap, manualLink };
