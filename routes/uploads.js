const express = require('express');
const pool = require('../db');
const cloud = require('../lib/cloudinary');

const router = express.Router();

// File ki asli pehchan uske pehle bytes (magic bytes) se; browser ke bheje content-type par bharosa nahi.
// SVG jaan boojh kar allow nahi (us mein script ho sakti hai).
function detectImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  const head = buf.subarray(0, 6).toString('latin1');
  if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  return null;
}

// Video: MP4 (ftyp box, 4 se 8 byte) ya WebM (EBML header)
function detectVideo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null;
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') return 'video/mp4';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm';
  return null;
}

const requireAdminJson = (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Please log in again.' });
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Only the blog owner can upload files.' });
  next();
};

// ---------- UPLOAD (admin) ----------
// Body seedha image bytes hoti hai (app.js mein express.raw). Editor page is se pehle browser mein resize karta hai.
router.post('/upload-image', requireAdminJson, async (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return res.status(400).json({ error: 'Please choose a JPG, PNG, WebP or GIF image.' });
  }
  const mime = detectImage(buf);
  if (!mime) return res.status(400).json({ error: 'Only JPG, PNG, WebP or GIF images are allowed.' });

  try {
    // Pehle Cloudinary (agar set hai). Na chale to database mein save: user ka upload zaya nahi hota.
    let remote = null;
    if (cloud.enabled()) {
      try {
        remote = (await cloud.uploadImage(buf, mime)).url;
      } catch (e) {
        console.error('[upload] Cloudinary fail, database mein save kar raha hoon:', e.message);
      }
    }
    const r = await pool.query(
      'INSERT INTO images (mime, data, size, uploaded_by, remote_url) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [mime, remote ? null : buf, buf.length, req.session.user.id, remote]
    );
    // URL pehle jaisa /img/ID hi rehta hai (poll, sponsor logo, posts sab usi par chalte hain)
    res.json({ url: `/img/${r.rows[0].id}` });
  } catch (err) {
    console.error('[upload]', err.message);
    res.status(500).json({ error: 'Upload failed. Please try again.' });
  }
});

// ---------- VIDEO UPLOAD (admin) ----------
// Body seedha video bytes (app.js mein express.raw, hadd config.videoMaxMb).
router.post('/upload-video', requireAdminJson, async (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return res.status(400).json({ error: 'Please choose an MP4 or WebM video.' });
  }
  const mime = detectVideo(buf);
  if (!mime) return res.status(400).json({ error: 'Only MP4 or WebM videos are allowed.' });

  try {
    const r = await pool.query(
      'INSERT INTO videos (mime, data, size, uploaded_by) VALUES ($1, $2, $3, $4) RETURNING id',
      [mime, buf, buf.length, req.session.user.id]
    );
    res.json({ url: `/video/${r.rows[0].id}` });
  } catch (err) {
    console.error('[upload-video]', err.message);
    res.status(500).json({ error: 'Upload failed. Please try again.' });
  }
});

// ---------- VIDEO SERVE (Range support: seek + phone/Safari playback) ----------
const CHUNK = 4 * 1024 * 1024; // ek Range jawab mein max 4 MB, taake memory par bojh na pare

router.get('/video/:id', async (req, res) => {
  const id = /^\d{1,9}$/.test(req.params.id) ? parseInt(req.params.id, 10) : null;
  if (!id) return res.status(404).end();

  try {
    const meta = await pool.query('SELECT mime, size FROM videos WHERE id = $1', [id]);
    const v = meta.rows[0];
    if (!v) return res.status(404).end();

    const size = v.size;
    let start = 0;
    let end = size - 1;
    let status = 200;

    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m || (m[1] === '' && m[2] === '')) {
        return res.status(416).set('Content-Range', `bytes */${size}`).end();
      }
      if (m[1] === '') {                       // bytes=-500 (aakhri 500 bytes)
        start = Math.max(size - parseInt(m[2], 10), 0);
      } else {
        start = parseInt(m[1], 10);
        if (m[2] !== '') end = Math.min(parseInt(m[2], 10), size - 1);
      }
      if (start >= size || start > end) {
        return res.status(416).set('Content-Range', `bytes */${size}`).end();
      }
      end = Math.min(end, start + CHUNK - 1);
      status = 206;
    }

    const len = end - start + 1;
    // Sirf zaroori hissa database se (poori file memory mein nahi aati)
    const r = await pool.query(
      'SELECT substring(data from $2::int for $3::int) AS chunk FROM videos WHERE id = $1',
      [id, start + 1, len]
    );
    const chunk = r.rows[0] && r.rows[0].chunk;
    if (!chunk) return res.status(404).end();

    res.status(status).set({
      'Content-Type': v.mime,
      'Content-Length': chunk.length,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      ...(status === 206 ? { 'Content-Range': `bytes ${start}-${start + chunk.length - 1}/${size}` } : {}),
    });
    res.end(chunk);
  } catch (err) {
    console.error('[video]', err.message);
    if (!res.headersSent) res.status(500).end();
  }
});

// ---------- SERVE ----------
router.get('/img/:id', async (req, res) => {
  const id = /^\d{1,9}$/.test(req.params.id) ? parseInt(req.params.id, 10) : null;
  if (!id) return res.status(404).end();

  try {
    const r = await pool.query('SELECT mime, data, remote_url FROM images WHERE id = $1', [id]);
    const img = r.rows[0];
    if (!img) return res.status(404).end();

    // Cloudinary wali image: wahin bhej do (browser is redirect ko bhi saal bhar cache karta hai)
    if (img.remote_url) {
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      return res.redirect(302, cloud.optimized(img.remote_url));
    }

    res.set({
      'Content-Type': img.mime,
      'Cache-Control': 'public, max-age=31536000, immutable', // image kabhi badalti nahi, nayi upload ko nayi id milti hai
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(img.data);
  } catch (err) {
    console.error('[img]', err.message);
    res.status(500).end();
  }
});

module.exports = router;
module.exports.detectImage = detectImage;
module.exports.detectVideo = detectVideo;
