// Public profile (/u/username), follow / unfollow, aur referral (/invite, /r/CODE).
const express = require('express');
const pool = require('../db');
const config = require('../config');
const { notifyUser } = require('../lib/notify');
const Profile = require('../lib/profile');
const R = require('../lib/referral');
const { profileLink } = require('../lib/follow');

const router = express.Router();
const isProd = process.env.NODE_ENV === 'production';
const baseUrl = (req) => config.siteUrl || `${req.protocol}://${req.get('host')}`;

const requireLogin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  next();
};

const findUser = async (name) => {
  const r = await pool.query(
    'SELECT id, username, role, created_at FROM users WHERE lower(username) = lower($1) ORDER BY id LIMIT 1',
    [String(name || '').slice(0, 50)]
  );
  return r.rows[0] || null;
};
// Follow button post page par bhi hai: wahan se wapas wahin
const safeRet = (v, fallback) => (/^\/posts\/[a-z0-9-]{1,120}$/.test(String(v || '')) ? String(v) : fallback);

// ---------- PUBLIC PROFILE ----------
router.get('/u/:username', async (req, res, next) => {
  try {
    const profile = await findUser(req.params.username);
    if (!profile) return next();
    const me = req.session.user ? req.session.user.id : null;
    const data = await Profile.load(profile, me);
    const isMe = me === profile.id;
    res.render('profile', {
      title: `${profile.username} · Profile`,
      metaDescription: `${profile.username} on ${config.siteName}: ${data.stats.votes} votes, ${data.stats.pts} prediction points, ${data.badges.length} badges.`,
      profile, ...data, isMe,
      selfPath: profileLink(profile.username),
      followMsg: req.query.followed === '1' ? `You now follow ${profile.username}. You will be notified about their new posts and contests.`
        : req.query.followed === '0' ? `You unfollowed ${profile.username}.` : null,
    });
  } catch (err) { next(err); }
});

// ---------- FOLLOW / UNFOLLOW ----------
router.post('/u/:username/follow', requireLogin, async (req, res, next) => {
  try {
    const target = await findUser(req.params.username);
    if (!target) return res.redirect('/');
    const me = req.session.user;
    const back = safeRet(req.body.ret, profileLink(target.username));
    if (target.id === me.id) return res.redirect(back);

    const ins = await pool.query(
      'INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING follower_id',
      [me.id, target.id]
    );
    if (ins.rows[0]) {
      notifyUser(target.id, `${me.username} started following you`, profileLink(me.username)); // sirf in-app
    }
    res.redirect(back + (back.includes('?') ? '&' : '?') + 'followed=1');
  } catch (err) { next(err); }
});

router.post('/u/:username/unfollow', requireLogin, async (req, res, next) => {
  try {
    const target = await findUser(req.params.username);
    if (!target) return res.redirect('/');
    await pool.query('DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2', [req.session.user.id, target.id]);
    const back = safeRet(req.body.ret, profileLink(target.username));
    res.redirect(back + (back.includes('?') ? '&' : '?') + 'followed=0');
  } catch (err) { next(err); }
});

// Email alerts on/off (in-app notification hamesha aati rehti hai)
router.post('/u/:username/follow-email', requireLogin, async (req, res, next) => {
  try {
    const target = await findUser(req.params.username);
    if (!target) return res.redirect('/');
    await pool.query(
      'UPDATE follows SET notify_email = NOT notify_email WHERE follower_id = $1 AND followee_id = $2',
      [req.session.user.id, target.id]
    );
    res.redirect(profileLink(target.username));
  } catch (err) { next(err); }
});

// ---------- REFERRAL ----------
// Dost ka link: code cookie mein 30 din yaad rakho, phir signup par bhejo
router.get('/r/:code', async (req, res, next) => {
  try {
    const code = String(req.params.code || '').toLowerCase();
    if (!R.CODE_RE.test(code)) return res.redirect('/');
    const r = await pool.query('SELECT id FROM users WHERE referral_code = $1', [code]);
    if (!r.rows[0]) return res.redirect('/');
    if (req.session.user) return res.redirect('/'); // pehle se member hai
    res.cookie('ref', code, { maxAge: 30 * 24 * 3600 * 1000, httpOnly: true, sameSite: 'lax', secure: isProd });
    res.redirect('/signup');
  } catch (err) { next(err); }
});

router.get('/invite', requireLogin, async (req, res, next) => {
  try {
    const me = req.session.user;
    const code = await R.ensureCode(me.id);
    const [stats, top] = await Promise.all([R.statsFor(me.id), R.leaderboard(10)]);
    const link = `${baseUrl(req)}/r/${code}`;
    const text = `Join me on ${config.siteName}! Vote in contests, predict cricket matches and win prizes 🎁\n${link}`;
    res.render('invite', {
      title: 'Invite friends',
      link,
      waUrl: 'https://wa.me/?text=' + encodeURIComponent(text),
      stats,
      earned: R.tiersFor(stats.qualified),
      next: R.nextTier(stats.qualified),
      tiers: R.TIERS,
      top,
      maxBonus: R.MAX_BONUS_ENTRIES,
    });
  } catch (err) { next(err); }
});

module.exports = router;
