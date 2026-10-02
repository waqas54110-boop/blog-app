// Friends page (/friends): sab registered users, request bhejo, aayi hui requests accept / decline, friend list.
const express = require('express');
const pool = require('../db');
const F = require('../lib/friends');
const Blocks = require('../lib/blocks');

const router = express.Router();

const requireLogin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  next();
};

const findUser = async (name) => {
  const r = await pool.query(
    'SELECT id, username FROM users WHERE lower(username) = lower($1) ORDER BY id LIMIT 1',
    [String(name || '').slice(0, 50)]
  );
  return r.rows[0] || null;
};

// Sirf apni site ke andar wapas bhejo (open redirect nahi): /friends... ya /u/<name>
const safeBack = (v, fallback) => {
  const s = String(v || '');
  return /^\/friends(\?[a-z0-9=&%+_.-]{0,100})?$/i.test(s) || /^\/u\/[^/?#\s]{1,80}$/.test(s) ? s : fallback;
};

router.get('/friends', requireLogin, async (req, res, next) => {
  try {
    const me = req.session.user;
    const tab = ['people', 'requests', 'friends', 'blocked'].includes(req.query.tab) ? req.query.tab : 'people';
    const q = String(req.query.q || '').trim().slice(0, 50);
    const [incoming, outgoing, friends, blocked] = await Promise.all([
      F.incoming(me.id), F.outgoing(me.id), F.friendList(me.id), Blocks.blockedList(me.id),
    ]);
    const people = tab === 'people' ? await F.people(me.id, q) : [];
    res.render('friends', {
      title: 'Friends',
      tab, q, people, incoming, outgoing, friends, blocked,
      msg: req.query.msg ? String(req.query.msg).slice(0, 120) : null,
    });
  } catch (err) { next(err); }
});

// action -> (me, other) -> flash message
const ACTIONS = {
  request: async (me, o) => {
    const st = await F.sendRequest(me, o);
    if (st === 'blocked') return `You can't send a request to ${o.username}.`;
    return st === 'friends' ? `You and ${o.username} are now friends.` : `Friend request sent to ${o.username}.`;
  },
  accept: async (me, o) => {
    const st = await F.acceptRequest(me, o);
    return st === 'friends' ? `You and ${o.username} are now friends and follow each other.` : 'That request is no longer available.';
  },
  decline: async (me, o) => { await F.removePending(me, o); return 'Request removed.'; },
  remove: async (me, o) => { await F.unfriend(me, o); return `${o.username} removed from your friends.`; },
  block: async (me, o) => { await Blocks.block(me.id, o.id); return `${o.username} is blocked. They can no longer send you requests or messages.`; },
  unblock: async (me, o) => { await Blocks.unblock(me.id, o.id); return `${o.username} is unblocked.`; },
};

// Express 5: regex wale params nahi chalte, is liye har action ka alag route
Object.keys(ACTIONS).forEach((action) => {
  router.post(`/friends/${action}/:username`, requireLogin, async (req, res, next) => {
    try {
      const me = req.session.user;
      const other = await findUser(req.params.username);
      const back = safeBack(req.body.ret, '/friends');
      if (!other || other.id === me.id) return res.redirect(back);
      const msg = await ACTIONS[action](me, other);
      res.redirect(back + (back.includes('?') ? '&' : '?') + 'msg=' + encodeURIComponent(msg));
    } catch (err) { next(err); }
  });
});

module.exports = router;
