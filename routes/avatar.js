// Profile photo: upload (browser pehle 256x256 JPEG bana deta hai), hatana, aur /a/:username se dikhana.
const express = require('express');
const pool = require('../db');
const cloud = require('../lib/cloudinary');
const { detectImage } = require('./uploads');

const router = express.Router();

// ---------- UPLOAD ----------
// Body seedha JPEG bytes (app.js mein express.raw, hadd 1 MB; CSRF token header x-csrf-token mein)
router.post('/upload-avatar', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Please log in again.' });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length === 0) return res.status(400).json({ error: 'Please choose an image.' });
  if (detectImage(buf) !== 'image/jpeg') return res.status(400).json({ error: 'Only JPG images are accepted here.' });

  try {
    let remote = null;
    if (cloud.enabled()) {
      try { remote = (await cloud.uploadImage(buf, 'image/jpeg')).url; }
      catch (e) { console.error('[avatar] Cloudinary fail, database mein save kar raha hoon:', e.message); }
    }
    const uid = req.session.user.id;
    const ins = await pool.query(
      'INSERT INTO images (mime, data, size, uploaded_by, remote_url) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      ['image/jpeg', remote ? null : buf, buf.length, uid, remote]
    );
    const newId = ins.rows[0].id;
    const old = await pool.query('SELECT avatar_image_id FROM users WHERE id = $1', [uid]);
    await pool.query('UPDATE users SET avatar_image_id = $1 WHERE id = $2', [newId, uid]);
    // Purani profile photo ki row hata do (database bharta na rahe)
    if (old.rows[0] && old.rows[0].avatar_image_id) {
      await pool.query('DELETE FROM images WHERE id = $1 AND uploaded_by = $2', [old.rows[0].avatar_image_id, uid]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[avatar upload]', err.message);
    res.status(500).json({ error: 'Upload failed. Please try again.' });
  }
});

router.post('/avatar/remove', async (req, res, next) => {
  try {
    if (!req.session.user) return res.redirect('/login');
    const uid = req.session.user.id;
    const old = await pool.query('SELECT avatar_image_id FROM users WHERE id = $1', [uid]);
    await pool.query('UPDATE users SET avatar_image_id = NULL WHERE id = $1', [uid]);
    if (old.rows[0] && old.rows[0].avatar_image_id) {
      await pool.query('DELETE FROM images WHERE id = $1 AND uploaded_by = $2', [old.rows[0].avatar_image_id, uid]);
    }
    res.redirect('/u/' + encodeURIComponent(req.session.user.username));
  } catch (err) { next(err); }
});

// ---------- SERVE ----------
// /a/username -> photo (redirect to /img/ID). Photo na ho to 404, aur page par naam ka pehla harf dikhta rehta hai.
router.get('/a/:username', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT avatar_image_id FROM users WHERE lower(username) = lower($1) ORDER BY id LIMIT 1',
      [String(req.params.username || '').slice(0, 50)]
    );
    const id = r.rows[0] && r.rows[0].avatar_image_id;
    res.set('Cache-Control', 'public, max-age=60');
    if (!id) return res.status(404).end();
    res.redirect(302, `/img/${id}`);
  } catch (err) {
    res.status(404).end();
  }
});

module.exports = router;
