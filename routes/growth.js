// Traffic features ke routes: share-card images, PWA (manifest + service worker + icons),
// push subscribe/unsubscribe, aur IndexNow key file.
const fs = require('fs');
const path = require('path');
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

// ---------- Google Search Console: HTML file verification ----------
// Sirf wahi ek file jo Search Console ne di (dusre naam par kuch nahi dikhta, warna koi aur bhi aap ki site verify kar leta).
const GSC_FILE = (process.env.GOOGLE_VERIFICATION_FILE || 'google8e618c09543de0d7.html').replace(/[^A-Za-z0-9_.-]/g, '');
router.get('/' + GSC_FILE, (req, res) => {
  res.type('text/html').send(`google-site-verification: ${GSC_FILE}`);
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
router.get(/^\/icons\/(180|192|512|maskable-512)\.png$/, async (req, res) => {
  if (!card.isAvailable()) return res.status(404).end();
  try {
    const maskable = req.params[0] === 'maskable-512'; // Android ka gol / squircle crop: letter beech ke safe hisse mein
    sendPng(res, await card.renderIcon(maskable ? 512 : Number(req.params[0]), siteLetter(), maskable), 86400);
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
        { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ]
    : [];
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('application/manifest+json').send(JSON.stringify({
    id: '/',
    name: config.siteName,
    short_name: config.siteName.slice(0, 12),
    description: 'Community feed, stories, groups, blog and contests.',
    lang: 'en',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#4f46e5',
    categories: ['social', 'news'],
    icons,
    // Home screen icon par long-press karne par shortcuts
    shortcuts: [
      { name: 'Feed', url: '/' },
      { name: 'Groups', url: '/groups' },
      { name: 'Blog', url: '/blog' },
    ],
  }));
});

// Internet na ho to ye page dikhta hai (service worker isay install par save kar leta hai)
router.get('/offline', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.render('offline', { title: 'Offline' });
});

// Service worker root par hona chahiye (poori site par chale). no-cache: update foran mile.
// Code pwa/sw.js mein hai.
const SW = fs.readFileSync(path.join(__dirname, '..', 'pwa', 'sw.js'), 'utf8');
router.get('/sw.js', (req, res) => {
  res.set({ 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
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