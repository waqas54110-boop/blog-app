// IP Checker (V57): /ip-check (page), /ip-check/ping and /ip-check/blob (used by the "test your own connection" box).
// Standalone: no login needed, no database, no change to any other feature.
const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const L = require('../lib/ipcheck');

const router = express.Router();
const baseUrlOf = (req) => config.siteUrl || `${req.protocol}://${req.get('host')}`;

router.get('/ip-check', async (req, res) => {
  const base = baseUrlOf(req);
  const visitor = L.normalize(req.ip);
  const visitorIp = visitor.ip || String(req.ip || '');
  const q = String(req.query.ip || '').trim();
  const mac = String(req.query.mac || '').trim();

  let result = null;
  let error = null;
  let typed = q;
  if (q) {
    const n = L.normalize(q);
    if (n.error) error = n.error;
    else {
      typed = n.ip;
      result = await L.check(n.ip, { own: n.ip === visitorIp, ua: req.get('user-agent') });
    }
  }
  const macInfo = mac ? await L.macVendor(mac) : null;

  const title = 'IP Address Checker: Country, ISP, VPN / Proxy and Wi-Fi Help';
  const description = 'Type any IP address to see its country, ISP, whether it is a mobile, home or server IP, whether it is hidden behind a VPN or proxy, and how to fix Wi-Fi address problems.';
  if (q || mac) res.locals.robots = 'noindex,follow'; // do not let search engines index every checked IP
  res.render('ip-check', {
    title,
    metaDescription: description,
    ogUrl: base + '/ip-check',
    ogType: 'website',
    jsonLd: [{
      '@context': 'https://schema.org', '@type': 'WebApplication', name: 'IP Address Checker', url: base + '/ip-check',
      applicationCategory: 'UtilitiesApplication', operatingSystem: 'Any', description,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    }],
    q: typed,
    mac,
    result,
    error,
    macInfo,
    me: { ip: visitorIp, device: L.parseUA(req.get('user-agent')) },
  });
});

// tiny reply, used to measure the round-trip time (ping) of the visitor's connection
router.get('/ip-check/ping', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(204).end();
});

// random (incompressible) bytes, used to measure the download speed of the visitor's connection
router.get('/ip-check/blob', (req, res) => {
  const kb = Math.min(Math.max(parseInt(req.query.kb, 10) || 400, 50), 600);
  res.set({ 'Cache-Control': 'no-store', 'Content-Type': 'application/octet-stream' });
  res.send(crypto.randomBytes(kb * 1024));
});

module.exports = router;
