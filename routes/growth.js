// Traffic features ke routes: share-card images, PWA (manifest + service worker + icons),
// push subscribe/unsubscribe, aur IndexNow key file.
const express = require('express');
const pool = require('../db');
const config = require('../config');
const card = require('../lib/card');
const push = require('../lib/push');
const { KEY } = require('../lib/indexnow');

const router = express.Router();
const siteLetter = () => (config.siteName || 'B').trim().charAt(0).toUpperCase() || 'B';

const sendPng = (res, buf, maxAge = 3600) => {
  res.set('Cache-Control', `public, max-age=${maxAge}`);
  res.type('image/png').send(buf);
};

// ---------- IndexNow key file (Bing wagera is se verify karte hain ke site aap ki hai) ----------
router.get(/^\/([A-Za-z0-9-]{8,128})\.txt$/, (req, res, next) => {
  if (req.params[0] !== KEY) return next();
  res.type('text/plain').send(KEY);
});

// ---------- Share cards ----------
router.get('/og/site.png', async (req, res) => {
  if (!card.isAvailable()) return res.status(404).end();
  try {
    sendPng(res, await card.renderCard({
      title: config.siteName,
      category: '',
      siteName: 'Notes & tutorials',
      meta: '',
    }), 86400);
  } catch (err) {
    console.error('[card] site:', err.message);
    res.status(404).end();
  }
});

router.get(/^\/og\/([a-z0-9-]{1,120})\.png$/, async (req, res) => {
  if (!card.isAvailable()) return res.status(404).end();
  try {
    const r = await pool.query(
      `SELECT p.title, p.category, p.content FROM posts p
       WHERE p.slug = $1 AND p.is_draft = false AND p.publish_at <= now()`,
      [req.params[0]]
    );
    const p = r.rows[0];
    if (!p) return res.status(404).end();
    const mins = Math.max(Math.ceil(p.content.trim().split(/\s+/).length / 200), 1);
    sendPng(res, await card.renderCard({
      title: p.title,
      category: p.category,
      siteName: config.siteName,
      meta: `${mins} min read`,
    }));
  } catch (err) {
    console.error('[card] post:', err.message);
    res.status(404).end();
  }
});

// ---------- PWA ----------
router.get(/^\/icons\/(192|512)\.png$/, async (req, res) => {
  if (!card.isAvailable()) return res.status(404).end();
  try {
    sendPng(res, await card.renderIcon(Number(req.params[0]), siteLetter()), 86400);
  } catch (err) {
    console.error('[card] icon:', err.message);
    res.status(404).end();
  }
});

router.get('/manifest.webmanifest', (req, res) => {
  const icons = card.isAvailable()
    ? [
        { src: '/icons/192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      ]
    : [];
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('application/manifest+json').send(JSON.stringify({
    name: config.siteName,
    short_name: config.siteName.slice(0, 12),
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#4f46e5',
    icons,
  }));
});

// Service worker root par hona chahiye (poori site par chale). no-cache: update foran mile.
const SW = `
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () {});

self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  var title = data.title || 'New post';
  var opts = {
    body: data.body || '',
    data: { url: data.url || '/' },
    tag: data.tag || undefined
  };
  if (data.icon) { opts.icon = data.icon; opts.badge = data.icon; }
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url === target && 'focus' in list[i]) return list[i].focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
`;
router.get('/sw.js', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('application/javascript').send(SW);
});

// ---------- Push subscribe / unsubscribe ----------
router.get('/push/key', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const key = await push.getPublicKey();
  if (!key) return res.status(404).json({ error: 'Push is not enabled.' });
  res.json({ key });
});

router.post('/push/subscribe', async (req, res) => {
  const sub = push.validSubscription(req.body);
  if (!sub) return res.status(400).json({ error: 'Invalid subscription.' });
  try {
    await push.saveSubscription(sub, req.session.user ? req.session.user.id : null);
    res.json({ ok: true });
  } catch (err) {
    console.error('[push] subscribe:', err.message);
    res.status(500).json({ error: 'Could not save subscription.' });
  }
});

router.post('/push/unsubscribe', async (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (typeof endpoint !== 'string') return res.status(400).json({ error: 'Invalid request.' });
  try {
    await push.removeSubscription(endpoint);
    res.json({ ok: true });
  } catch (err) {
    console.error('[push] unsubscribe:', err.message);
    res.status(500).json({ error: 'Could not remove subscription.' });
  }
});

module.exports = router;
