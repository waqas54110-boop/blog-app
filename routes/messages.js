// Private messages (/messages): friends ke saath chat. Text, photo, voice message, "typing..." aur "seen" ✓✓.
const express = require('express');
const pool = require('../db');
const Msg = require('../lib/messages');
const Typing = require('../lib/typing');

const router = express.Router();

const requireLogin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  next();
};
const requireLoginJson = (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Please log in again.' });
  next();
};

const findUser = async (name) => {
  const r = await pool.query(
    'SELECT id, username FROM users WHERE lower(username) = lower($1) ORDER BY id LIMIT 1',
    [String(name || '').slice(0, 50)]
  );
  return r.rows[0] || null;
};
const chatLink = (u) => `/messages/${encodeURIComponent(u.username)}`;

// Browser ko jaane wala message (poll aur media upload dono isi shakal mein jawab dete hain)
const toJson = (m, meId) => ({
  id: m.id, mine: m.sender_id === meId, body: m.body, at: m.created_at,
  kind: m.media_kind || null, secs: m.media_secs || null, media: m.media_id || null,
});

router.get('/messages', requireLogin, async (req, res, next) => {
  try {
    const list = await Msg.conversations(req.session.user.id);
    res.render('messages', { title: 'Messages', list });
  } catch (err) { next(err); }
});

// ---------- MEDIA SERVE (sirf us chat ke do log; Range support taake voice phone / Safari par chale) ----------
const CHUNK = 2 * 1024 * 1024;
router.get('/messages/media/:id', requireLogin, async (req, res) => {
  const id = /^\d{1,9}$/.test(req.params.id) ? parseInt(req.params.id, 10) : null;
  if (!id) return res.status(404).end();
  try {
    const meta = await Msg.mediaMeta(id, req.session.user.id, res.locals.isAdmin);
    if (!meta) return res.status(404).end();

    const size = meta.size;
    let start = 0;
    let end = size - 1;
    let status = 200;
    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m || (m[1] === '' && m[2] === '')) return res.status(416).set('Content-Range', `bytes */${size}`).end();
      if (m[1] === '') start = Math.max(size - parseInt(m[2], 10), 0);
      else {
        start = parseInt(m[1], 10);
        if (m[2] !== '') end = Math.min(parseInt(m[2], 10), size - 1);
      }
      if (start >= size || start > end) return res.status(416).set('Content-Range', `bytes */${size}`).end();
      end = Math.min(end, start + CHUNK - 1);
      status = 206;
    }
    const len = end - start + 1;
    const r = await pool.query(
      'SELECT substring(data from $2::int for $3::int) AS chunk FROM message_media WHERE id = $1',
      [id, start + 1, len]
    );
    const chunk = r.rows[0] && r.rows[0].chunk;
    if (!chunk) return res.status(404).end();
    res.status(status).set({
      'Content-Type': meta.mime,
      'Content-Length': chunk.length,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=86400', // private chat: shared cache / CDN mein nahi
      'X-Content-Type-Options': 'nosniff',
      ...(status === 206 ? { 'Content-Range': `bytes ${start}-${start + chunk.length - 1}/${size}` } : {}),
    });
    res.end(chunk);
  } catch (err) {
    console.error('[message media]', err.message);
    if (!res.headersSent) res.status(500).end();
  }
});

router.get('/messages/:username', requireLogin, async (req, res, next) => {
  try {
    const me = req.session.user;
    const other = await findUser(req.params.username);
    if (!other) return next();
    if (other.id === me.id) return res.redirect('/messages');

    const can = await Msg.canChat(me.id, other.id);
    if (can === 'not_friends') {
      return res.redirect('/friends?tab=people&msg=' + encodeURIComponent(`You can message ${other.username} after you become friends.`));
    }
    if (can === 'blocked') {
      // Kis ne block kiya ye nahi batate; purani chat bhi nahi dikhate
      return res.render('chat', { title: 'Messages', other, blocked: true, messages: [], lastId: 0, seenUpTo: 0, maxLen: Msg.MAX_LEN, maxVoiceSecs: Msg.VOICE_MAX_SECS, err: null });
    }
    await Msg.markRead(me.id, other.id);
    const messages = await Msg.thread(me.id, other.id);
    res.render('chat', {
      title: `Chat with ${other.username}`,
      other, blocked: false, messages,
      lastId: messages.length ? messages[messages.length - 1].id : 0,
      seenUpTo: await Msg.seenUpTo(me.id, other.id),
      maxLen: Msg.MAX_LEN,
      maxVoiceSecs: Msg.VOICE_MAX_SECS,
      err: req.query.err ? String(req.query.err).slice(0, 120) : null,
    });
  } catch (err) { next(err); }
});

router.post('/messages/:username', requireLogin, async (req, res, next) => {
  try {
    const me = req.session.user;
    const other = await findUser(req.params.username);
    if (!other || other.id === me.id) return res.redirect('/messages');
    const back = chatLink(other);
    if ((await Msg.canChat(me.id, other.id)) !== 'ok') return res.redirect(back);

    const c = Msg.clean(req.body.body);
    if (c.error) return res.redirect(back + '?err=' + encodeURIComponent(c.error));
    const m = await Msg.send(me, other, c.body);
    Typing.clear(Typing.dmScope(me.id, other.id), me.id).catch(() => {});
    res.redirect(back + '#m' + m.id);
  } catch (err) { next(err); }
});

// ---------- PHOTO / VOICE BHEJNA ----------
// Body seedhi file bytes (app.js mein express.raw; CSRF token header mein). Header x-duration: voice ke seconds.
router.post('/messages/:username/media', requireLoginJson, async (req, res) => {
  try {
    const me = req.session.user;
    const other = await findUser(req.params.username);
    if (!other || other.id === me.id) return res.status(404).json({ error: 'User not found.' });
    if ((await Msg.canChat(me.id, other.id)) !== 'ok') return res.status(403).json({ error: 'You can\'t message this user.' });

    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) return res.status(400).json({ error: 'Nothing to send.' });
    const media = Msg.detectMedia(buf);
    if (!media) return res.status(400).json({ error: 'This file type is not supported.' });
    if (media.kind === 'image' && buf.length > Msg.IMAGE_MAX) return res.status(413).json({ error: 'Photo is too large.' });
    if (media.kind === 'voice' && buf.length > Msg.VOICE_MAX) return res.status(413).json({ error: 'Voice message is too long.' });

    const duration = /^\d{1,4}$/.test(String(req.get('x-duration') || '')) ? parseInt(req.get('x-duration'), 10) : 0;
    const m = await Msg.sendMedia(me, other, { buf, kind: media.kind, mime: media.mime, duration });
    Typing.clear(Typing.dmScope(me.id, other.id), me.id).catch(() => {});
    res.json({ ok: true, message: toJson({ ...m, sender_id: me.id, body: '' }, me.id) });
  } catch (err) {
    console.error('[message media send] (migration_v22.sql chali?):', err.message);
    res.status(500).json({ error: 'Could not send. Please try again.' });
  }
});

// Naye messages + "seen" + "typing" (page khula ho to har kuch second baad browser poochta hai)
router.get('/messages/:username/poll', requireLoginJson, async (req, res) => {
  try {
    const me = req.session.user;
    const other = await findUser(req.params.username);
    if (!other || other.id === me.id) return res.status(404).json({ error: 'not found' });
    if ((await Msg.canChat(me.id, other.id)) !== 'ok') return res.status(403).json({ error: 'unavailable' });
    const scope = Typing.dmScope(me.id, other.id);
    if (req.query.typing === '1') await Typing.touch(scope, me.id);

    const after = /^\d{1,9}$/.test(String(req.query.after || '')) ? parseInt(req.query.after, 10) : 0;
    const rows = await Msg.thread(me.id, other.id, after, 50);
    if (rows.some((m) => m.sender_id === other.id)) await Msg.markRead(me.id, other.id);
    const [seen, typers] = await Promise.all([Msg.seenUpTo(me.id, other.id), Typing.who(scope, me.id)]);
    res.json({
      messages: rows.map((m) => toJson(m, me.id)),
      seen,
      typing: typers.length > 0,
    });
  } catch (err) {
    console.error('[messages poll]', err.message);
    res.status(500).json({ error: 'server' });
  }
});

module.exports = router;
