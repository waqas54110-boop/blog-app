// Public profile (/u/username), follow / unfollow, aur referral (/invite, /r/CODE).
const express = require('express');
const pool = require('../db');
const { cleanBirthYear, cleanGender, cleanCountry, MIN_AGE, MAX_AGE } = require('../lib/demographics');
const config = require('../config');
const { notifyUser } = require('../lib/notify');
const Profile = require('../lib/profile');
const R = require('../lib/referral');
const { profileLink } = require('../lib/follow');
const Friends = require('../lib/friends');
const Blocks = require('../lib/blocks');
const { profileLd } = require('../lib/seo');

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
    let friendState = 'none';
    let blockState = 'none'; // none | by_me | me
    let mutual = { count: 0, list: [] }; // "3 mutual friends"
    if (me && !isMe) {
      try {
        blockState = await Blocks.stateFor(me, profile.id);
        if (blockState === 'none') {
          friendState = await Friends.stateBetween(me, profile.id);
          mutual = await Friends.mutualFriends(me, profile.id, 3);
        }
      } catch (e) { console.error('friend/block state (migration_v14/v15 chali?):', e.message); }
    }
    // Profile photo ka version (browser cache badalne ke liye)
    let avatarVer = 0;
    try {
      const a = await pool.query('SELECT avatar_image_id FROM users WHERE id = $1', [profile.id]);
      avatarVer = (a.rows[0] && a.rows[0].avatar_image_id) || 0;
    } catch (e) { console.error('avatar (migration_v15.sql chali?):', e.message); }
    // Bio aur location (migration_v17.sql)
    let bio = '';
    let userLocation = '';
    try {
      const b = await pool.query('SELECT bio, location FROM users WHERE id = $1', [profile.id]);
      bio = (b.rows[0] && b.rows[0].bio) || '';
      userLocation = (b.rows[0] && b.rows[0].location) || '';
    } catch (e) { console.error('bio/location (migration_v17.sql chali?):', e.message); }
    // Feed posts ki ginti (migration_v18.sql). Chhupi hui posts sirf owner/admin ko ginti mein
    let feedCount = 0;
    try {
      const fc = await pool.query(
        'SELECT COUNT(*)::int AS n FROM feed_posts WHERE user_id = $1 AND group_id IS NULL AND (NOT is_hidden OR $2::boolean OR user_id = $3)',
        [profile.id, !!res.locals.isAdmin, me || 0]
      );
      feedCount = fc.rows[0].n;
    } catch (e) { console.error('feed count (migration_v18.sql chali?):', e.message); }
    res.render('profile', {
      friendState, blockState, mutual, avatarVer, bio, userLocation, feedCount,
      title: `${profile.username} · Profile`,
      // Khali profile (na bio, na feed post) patla page hai: Google index na kare
      robots: feedCount === 0 && !bio ? 'noindex,follow' : null,
      jsonLd: profileLd({
        base: config.siteUrl || `${req.protocol}://${req.get('host')}`, siteName: config.siteName,
        username: profile.username, bio,
        image: avatarVer ? `${config.siteUrl || `${req.protocol}://${req.get('host')}`}/a/${encodeURIComponent(profile.username)}` : null,
      }),
      metaDescription: `${profile.username} on ${config.siteName}: ${data.stats.votes} votes, ${data.stats.pts} prediction points, ${data.badges.length} badges.`,
      profile, ...data, isMe,
      selfPath: profileLink(profile.username),
      followMsg: req.query.followed === '1' ? `You now follow ${profile.username}. You will be notified about their new posts and contests.`
        : req.query.followed === '0' ? `You unfollowed ${profile.username}.`
        : req.query.msg ? String(req.query.msg).slice(0, 120) : null,
    });
  } catch (err) { next(err); }
});

// ---------- EDIT PROFILE ----------
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,30}$/;
const RENAME_DAYS = 30;
const BIO_MAX = 200;
const LOC_MAX = 60;
// Control / invisible (zero-width, bidi) characters hata do, extra blank lines kam karo
const cleanText = (s, max) => String(s || '')
  .replace(/\r\n?/g, '\n')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()
  .slice(0, max);
const HAS_LINK = /(https?:\/\/|www\.)/i;

const nextRenameDate = (changedAt) => {
  if (!changedAt) return null;
  const d = new Date(new Date(changedAt).getTime() + RENAME_DAYS * 24 * 3600 * 1000);
  return d > new Date() ? d : null; // null = abhi badal sakte hain
};

const loadEditRow = async (uid) => {
  const r = await pool.query('SELECT username, bio, location, username_changed_at, birth_year, gender, country FROM users WHERE id = $1', [uid]);
  return r.rows[0] || null;
};

const renderEdit = (res, row, form, error, status = 200, saved = false) =>
  res.status(status).render('edit-profile', {
    title: 'Edit profile',
    form, error, saved,
    currentUsername: row.username,
    lockedUntil: nextRenameDate(row.username_changed_at),
    renameDays: RENAME_DAYS, bioMax: BIO_MAX, locMax: LOC_MAX,
  });

router.get('/settings/profile', requireLogin, async (req, res, next) => {
  try {
    const row = await loadEditRow(req.session.user.id);
    if (!row) return res.redirect('/login');
    renderEdit(res, row, { username: row.username, bio: row.bio || '', location: row.location || '', birth_year: row.birth_year || '', gender: row.gender || '', country: row.country || '' }, null, 200, req.query.saved === '1');
  } catch (err) { next(err); }
});

router.post('/settings/profile', requireLogin, async (req, res, next) => {
  try {
    const uid = req.session.user.id;
    const row = await loadEditRow(uid);
    if (!row) return res.redirect('/login');

    const form = {
      username: String(req.body.username || '').trim(),
      bio: cleanText(req.body.bio, BIO_MAX),
      location: cleanText(req.body.location, LOC_MAX).replace(/\s*\n\s*/g, ' '),
      birth_year: cleanBirthYear(req.body.birth_year),
      gender: cleanGender(req.body.gender),
      country: cleanCountry(req.body.country),
    };
    const rawYear = String(req.body.birth_year || '').trim();
    const formView = { ...form, birth_year: rawYear, gender: form.gender || '', country: form.country || '' };
    const fail = (msg) => renderEdit(res, row, formView, msg, 400);

    if (HAS_LINK.test(form.bio) || HAS_LINK.test(form.location)) {
      return fail('Links are not allowed in your bio or location.');
    }

    if (rawYear && !form.birth_year) {
      return fail(`Birth year must be between ${new Date().getFullYear() - MAX_AGE} and ${new Date().getFullYear() - MIN_AGE} (or leave it empty).`);
    }

    const renaming = form.username !== row.username;
    if (renaming) {
      const lockedUntil = nextRenameDate(row.username_changed_at);
      if (lockedUntil) {
        return fail(`You can change your username once every ${RENAME_DAYS} days. Next change: ${lockedUntil.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.`);
      }
      if (!USERNAME_RE.test(form.username)) {
        return fail('Username must be 3 to 30 characters: letters, numbers, dot, dash or underscore only.');
      }
      const taken = await pool.query('SELECT 1 FROM users WHERE lower(username) = lower($1) AND id <> $2 LIMIT 1', [form.username, uid]);
      if (taken.rowCount) return fail('That username is already taken.');
    }

    try {
      if (renaming) {
        await pool.query(
          'UPDATE users SET username = $1, username_changed_at = now(), bio = $2, location = $3, birth_year = $5, gender = $6, country = $7 WHERE id = $4',
          [form.username, form.bio || null, form.location || null, uid, form.birth_year, form.gender, form.country]
        );
        req.session.user.username = form.username; // header / baqi pages naya naam dikhayen
      } else {
        await pool.query(
          'UPDATE users SET bio = $1, location = $2, birth_year = $4, gender = $5, country = $6 WHERE id = $3',
          [form.bio || null, form.location || null, uid, form.birth_year, form.gender, form.country]
        );
      }
    } catch (err) {
      if (err.code === '23505') return fail('That username is already taken.');
      throw err;
    }
    req.session.save((e) => {
      if (e) return next(e);
      res.redirect('/u/' + encodeURIComponent(req.session.user.username) + '?msg=' + encodeURIComponent('Profile updated.'));
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
    if (await Blocks.isBlockedEither(me.id, target.id)) return res.redirect(back); // block ho to follow nahi

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
