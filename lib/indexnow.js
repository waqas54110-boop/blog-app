// IndexNow: naya/edit hua post Bing, Yandex wagera ko foran batata hai (free, koi account nahi).
// Google IndexNow use nahi karta; us ke liye sitemap Search Console mein ek baar submit karein.
const crypto = require('crypto');
const config = require('../config');

// Key: .env ka INDEXNOW_KEY, warna SESSION_SECRET se khud ban jati hai (hamesha wahi rehti hai).
const envKey = process.env.INDEXNOW_KEY || '';
const KEY = /^[A-Za-z0-9-]{8,128}$/.test(envKey)
  ? envKey
  : crypto.createHash('sha256').update('indexnow:' + (process.env.SESSION_SECRET || 'blog')).digest('hex').slice(0, 32);

const ENDPOINT = 'https://api.indexnow.org/indexnow';
const recent = new Map(); // url -> last ping time (bar bar save karne par spam na ho)

function isPublicSite() {
  if (!config.siteUrl) return false;
  try {
    const h = new URL(config.siteUrl).hostname;
    return !(h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local'));
  } catch (e) {
    return false;
  }
}

// { ok, retry, status }: retry=true matlab network/server masla hai, baad mein dobara koshish theek hai
async function ping(urls, { throttle = false } = {}) {
  if (!isPublicSite()) return { ok: false, retry: false, status: 'SITE_URL not set (ya localhost)' };

  let list = [...new Set(urls)];
  if (throttle) {
    const now = Date.now();
    list = list.filter((u) => now - (recent.get(u) || 0) > 10 * 60 * 1000);
    list.forEach((u) => recent.set(u, now));
  }
  if (list.length === 0) return { ok: true, retry: false, status: 'skipped' };

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: new URL(config.siteUrl).host,
        key: KEY,
        keyLocation: `${config.siteUrl}/${KEY}.txt`,
        urlList: list,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const ok = res.status === 200 || res.status === 202;
    return { ok, retry: !ok && (res.status === 429 || res.status >= 500), status: res.status };
  } catch (err) {
    return { ok: false, retry: true, status: err.message };
  }
}

module.exports = { ping, KEY, isPublicSite };
