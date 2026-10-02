// Private messages (/messages): friends ke saath simple text chat.
const express = require('express');
const pool = require('../db');
const Msg = require('../lib/messages');

const router = express.Router();

const requireLogin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  next();
};
const requireLoginJson = (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'login' });
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

router.get('/messages', requireLogin, async (req, res, next) => {
  try {
    const list = await Msg.conversations(req.session.user.id);
    res.render('messages', { title: 'Messages', list });
  } catch (err) { next(err); }
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
      return res.render('chat', { title: 'Messages', other, blocked: true, messages: [], lastId: 0, maxLen: Msg.MAX_LEN, err: null });
    }
    await Msg.markRead(me.id, other.id);
    const messages = await Msg.thread(me.id, other.id);
    res.render('chat', {
      title: `Chat with ${other.username}`,
      other, blocked: false, messages,
      lastId: messages.length ? messages[messages.length - 1].id : 0,
      maxLen: Msg.MAX_LEN,
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
    res.redirect(back + '#m' + m.id);
  } catch (err) { next(err); }
});

// Naye messages (page khula ho to har kuch second baad browser poochta hai)
router.get('/messages/:username/poll', requireLoginJson, async (req, res) => {
  try {
    const me = req.session.user;
    const other = await findUser(req.params.username);
    if (!other || other.id === me.id) return res.status(404).json({ error: 'not found' });
    if ((await Msg.canChat(me.id, other.id)) !== 'ok') return res.status(403).json({ error: 'unavailable' });
    const after = /^\d{1,9}$/.test(String(req.query.after || '')) ? parseInt(req.query.after, 10) : 0;
    const rows = await Msg.thread(me.id, other.id, after, 50);
    if (rows.some((m) => m.sender_id === other.id)) await Msg.markRead(me.id, other.id);
    res.json({
      messages: rows.map((m) => ({ id: m.id, mine: m.sender_id === me.id, body: m.body, at: m.created_at })),
    });
  } catch (err) {
    console.error('[messages poll]', err.message);
    res.status(500).json({ error: 'server' });
  }
});

module.exports = router;
