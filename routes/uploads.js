const express = require('express');
const pool = require('../db');

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

const requireAdminJson = (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Please log in again.' });
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Only the blog owner can upload images.' });
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
    const r = await pool.query(
      'INSERT INTO images (mime, data, size, uploaded_by) VALUES ($1, $2, $3, $4) RETURNING id',
      [mime, buf, buf.length, req.session.user.id]
    );
    res.json({ url: `/img/${r.rows[0].id}` });
  } catch (err) {
    console.error('[upload]', err.message);
    res.status(500).json({ error: 'Upload failed. Please try again.' });
  }
});

// ---------- SERVE ----------
router.get('/img/:id', async (req, res) => {
  const id = /^\d{1,9}$/.test(req.params.id) ? parseInt(req.params.id, 10) : null;
  if (!id) return res.status(404).end();

  try {
    const r = await pool.query('SELECT mime, data FROM images WHERE id = $1', [id]);
    const img = r.rows[0];
    if (!img) return res.status(404).end();

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
