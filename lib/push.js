// Web push notifications. `web-push` package chahiye; na ho to baaqi site normal chalti hai.
// VAPID keys pehli baar khud ban kar database (app_settings) mein save ho jati hain, .env mein kuch nahi likhna.
// (Chahein to VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY .env mein de sakte hain.)
const pool = require('../db');
const config = require('../config');

let webpush = null;
try {
  webpush = require('web-push');
} catch (err) {
  console.log('[push] web-push package install nahi hai, push notifications band hain (npm install chalayein).');
}

let publicKey = null;
let initPromise = null;

async function loadKeys() {
  let pub = process.env.VAPID_PUBLIC_KEY || '';
  let priv = process.env.VAPID_PRIVATE_KEY || '';
  if (pub && priv) return { pub, priv };

  const read = async () => {
    const r = await pool.query("SELECT key, value FROM app_settings WHERE key IN ('vapid_public', 'vapid_private')");
    const m = Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
    return { pub: m.vapid_public, priv: m.vapid_private };
  };

  let k = await read();
  if (!k.pub || !k.priv) {
    const fresh = webpush.generateVAPIDKeys();
    // Do server ek saath chalein to pehli save jeetti hai
    await pool.query(
      "INSERT INTO app_settings (key, value) VALUES ('vapid_public', $1), ('vapid_private', $2) ON CONFLICT (key) DO NOTHING",
      [fresh.publicKey, fresh.privateKey]
    );
    k = await read();
  }
  return k;
}

// true = push tayyar hai
function init() {
  if (!webpush) return Promise.resolve(false);
  if (!initPromise) {
    initPromise = (async () => {
      const { pub, priv } = await loadKeys();
      const subject = config.siteUrl.startsWith('https://') ? config.siteUrl : 'mailto:admin@example.com';
      webpush.setVapidDetails(subject, pub, priv);
      publicKey = pub;
      return true;
    })().catch((err) => {
      initPromise = null; // agle baar dobara koshish
      console.error('[push] init fail (migration_v5.sql chali?):', err.message);
      return false;
    });
  }
  return initPromise;
}

async function getPublicKey() {
  return (await init()) ? publicKey : null;
}

// Sirf asli browser push services ke endpoints qubool (warna koi server ko apni marzi ke URL par request bhejne par laga sakta hai)
const PUSH_HOST_RE = /(^|\.)(googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/i;

function validSubscription(sub) {
  if (!sub || typeof sub.endpoint !== 'string' || !sub.keys) return null;
  const { p256dh, auth } = sub.keys;
  if (typeof p256dh !== 'string' || typeof auth !== 'string') return null;
  if (sub.endpoint.length > 1000 || p256dh.length > 200 || auth.length > 100) return null;
  let u;
  try { u = new URL(sub.endpoint); } catch (e) { return null; }
  if (u.protocol !== 'https:' || u.port || !PUSH_HOST_RE.test(u.hostname)) return null;
  return { endpoint: sub.endpoint, p256dh, auth };
}

async function saveSubscription(sub, userId) {
  await pool.query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
                                          user_id = COALESCE(EXCLUDED.user_id, push_subscriptions.user_id)`,
    [sub.endpoint, sub.p256dh, sub.auth, userId || null]
  );
}

async function removeSubscription(endpoint) {
  await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [String(endpoint).slice(0, 1000)]);
}

// Sab subscribers ko notification. Mari hui subscriptions (404/410) khud delete ho jati hain.
async function sendToAll(payload) {
  if (!(await init())) return { sent: 0, failed: 0, skipped: true };
  const subs = await pool.query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions');
  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < subs.rows.length; i += 20) {
    await Promise.all(
      subs.rows.slice(i, i + 20).map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
            { TTL: 60 * 60 * 24, timeout: 10000 }
          );
          sent++;
        } catch (err) {
          failed++;
          if (err.statusCode === 404 || err.statusCode === 410) {
            await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]).catch(() => {});
          } else {
            console.error('[push] send fail:', err.statusCode || err.message);
          }
        }
      })
    );
  }
  return { sent, failed, skipped: false };
}

// Ek hi device ko notification (guest product reminder). true = gayi
async function sendToEndpoint(endpoint, payload) {
  if (!(await init())) return false;
  const s = (await pool.query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE endpoint = $1', [endpoint])).rows[0];
  if (!s) return false;
  try {
    await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 60 * 60 * 24, timeout: 10000 });
    return true;
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]).catch(() => {});
    else console.error('[push] send fail:', err.statusCode || err.message);
    return false;
  }
}

const isAvailable = () => !!webpush;

module.exports = { init, getPublicKey, validSubscription, saveSubscription, removeSubscription, sendToAll, sendToEndpoint, isAvailable };
