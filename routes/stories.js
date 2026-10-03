// Stories: 24 ghante baad khatam hone wali photo ya text, feed ke upar gol icons mein.
// Photo ka upload pehle jaisa /upload-feed-image se hota hai; yahan sirf story banti / dikhti / hatati hai.
const express = require('express');
const pool = require('../db');
const spam = require('../lib/spam');
const Stories = require('../lib/stories');
const Images = require('../lib/images');

const router = express.Router();
const toId = (v) => (/^\d{1,9}$/.test(String(v)) ? parseInt(v, 10) : null);

// Sab endpoints JSON dete hain; login na ho to 401
const requireLogin = (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Please log in to use stories.' });
  next();
};

// Tray: apni + doosron ki chalti stories
router.get('/stories/tray.json', requireLogin, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const groups = await Stories.tray(req.session.user.id);
    res.json({ ok: true, isAdmin: !!res.locals.isAdmin, groups });
  } catch (err) {
    console.error('[stories tray] (migration_v20.sql chali?):', err.message);
    res.status(500).json({ error: 'Could not load stories.' });
  }
});

// Nayi story: text ya photo (image_id /upload-feed-image se aati hai), caption optional
router.post('/stories', requireLogin, async (req, res) => {
  const me = req.session.user;
  try {
    const body = String((req.body && req.body.body) || '').replace(/\r\n/g, '\n').trim();
    const imageId = toId(req.body && req.body.image_id);
    let bg = parseInt(req.body && req.body.bg, 10);
    if (!(bg >= 0 && bg < Stories.BG_COUNT)) bg = 0;

    if (!body && !imageId) return res.status(400).json({ error: 'Write something or add a photo first.' });
    if (body.length > Stories.BODY_MAX) return res.status(400).json({ error: `Story text is too long (max ${Stories.BODY_MAX} characters).` });

    if (body) {
      // Story ko "review mein rakho" ka rasta nahi, is liye shak wali text seedha rok di jati hai
      const v = await spam.check(body, { userId: me.id, isAdmin: res.locals.isAdmin });
      if (v.action === 'block' || v.action === 'hold') {
        return res.status(400).json({ error: 'This story looks like spam, so it was not posted.' });
      }
    }
    if (imageId) {
      const ok = await pool.query(
        `SELECT 1 FROM images WHERE id = $1 AND uploaded_by = $2 AND ${Images.unusedSql('$1')}`,
        [imageId, me.id]
      );
      if (!ok.rows[0]) return res.status(400).json({ error: 'That photo could not be used. Please add it again.' });
    }
    if ((await Stories.activeCount(me.id)) >= Stories.MAX_ACTIVE_PER_USER) {
      return res.status(429).json({ error: `You already have ${Stories.MAX_ACTIVE_PER_USER} active stories. Wait for some to expire or delete one.` });
    }

    const id = await Stories.create(me.id, { body, imageId, bg: imageId ? 0 : bg });
    res.json({ ok: true, id });
  } catch (err) {
    console.error('[story create] (migration_v20.sql chali?):', err.message);
    res.status(500).json({ error: 'Could not post your story. Please try again.' });
  }
});

// Story dekh li (ring grey ho jati hai, owner ko ginti milti hai)
router.post('/stories/:id/seen', requireLogin, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad request' });
  try {
    await Stories.markSeen(id, req.session.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[story seen]', err.message);
    res.json({ ok: false });
  }
});

// Kis ne dekhi (sirf story ka owner ya admin)
router.get('/stories/:id/viewers', requireLogin, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad request' });
  try {
    const rows = await Stories.viewers(id, req.session.user.id, res.locals.isAdmin);
    res.json({ ok: true, viewers: rows });
  } catch (err) {
    console.error('[story viewers]', err.message);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

router.post('/stories/:id/delete', requireLogin, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad request' });
  try {
    const ok = await Stories.remove(id, req.session.user.id, res.locals.isAdmin);
    if (!ok) return res.status(404).json({ error: 'Story not found.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[story delete]', err.message);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

module.exports = router;
