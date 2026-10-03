// Groups: cricket group, freelancing group... har group ki apni feed. Koi bhi login user join kar ke post kar sakta hai.
// Group ki post wahi feed_posts hai (like / comment / report / views sab pehle jaisa), bas us par group_id laga hota hai.
const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const config = require('../config');
const spam = require('../lib/spam');
const Feed = require('../lib/feed');
const Groups = require('../lib/groups');
const Images = require('../lib/images');

const router = express.Router();
const toId = (v) => (/^\d{1,9}$/.test(String(v)) ? parseInt(v, 10) : null);
const baseUrl = (req) => config.siteUrl || `${req.protocol}://${req.get('host')}`;
const oneLine = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const msg = (v) => (v ? String(v).slice(0, 200) : null);

const requireLogin = (req, res, next) => (req.session.user ? next() : res.redirect('/login'));
const canCreate = (res) => !config.groupsAdminOnly || res.locals.isAdmin;

// ---------- LIST ----------
router.get('/groups', async (req, res, next) => {
  try {
    const me = req.session.user ? req.session.user.id : null;
    const q = oneLine(req.query.q, 60);
    const groups = await Groups.list({ me, q });
    res.render('groups', {
      title: 'Groups',
      metaDescription: `Join a group on ${config.siteName}: cricket, freelancing and more. Every group has its own feed.`,
      groups, q, canCreate: canCreate(res), mine: groups.filter((g) => g.joined),
      notice: msg(req.query.notice), error: msg(req.query.err), deleted: req.query.deleted === '1',
    });
  } catch (err) { next(err); }
});

// ---------- CREATE ----------
router.get('/groups/new', requireLogin, (req, res) => {
  if (!canCreate(res)) return res.redirect('/groups?err=' + encodeURIComponent('Only the site owner can create groups.'));
  res.render('group-new', { title: 'Create a group', error: msg(req.query.err), form: { name: '', description: '', emoji: '' }, NAME_MAX: Groups.NAME_MAX, DESC_MAX: Groups.DESC_MAX });
});

router.post('/groups', requireLogin, async (req, res) => {
  const me = req.session.user;
  const form = { name: oneLine(req.body.name, Groups.NAME_MAX), description: oneLine(req.body.description, Groups.DESC_MAX), emoji: oneLine(req.body.emoji, 8) };
  const again = (error) => res.status(400).render('group-new', { title: 'Create a group', error, form, NAME_MAX: Groups.NAME_MAX, DESC_MAX: Groups.DESC_MAX });
  try {
    if (!canCreate(res)) return res.redirect('/groups?err=' + encodeURIComponent('Only the site owner can create groups.'));
    if (form.name.length < Groups.NAME_MIN) return again(`Group name must be at least ${Groups.NAME_MIN} characters.`);
    if (!form.emoji) form.emoji = '👥';

    const v = await spam.check(`${form.name} ${form.description}`, { userId: me.id, isAdmin: res.locals.isAdmin });
    if (v.action === 'block' || v.action === 'hold') return again('This group name or description looks like spam.');

    if (!res.locals.isAdmin && (await Groups.ownedCount(me.id)) >= Groups.MAX_OWNED) {
      return again(`You can own up to ${Groups.MAX_OWNED} groups.`);
    }
    const dup = await pool.query('SELECT 1 FROM groups WHERE lower(name) = lower($1)', [form.name]);
    if (dup.rows[0]) return again('A group with this name already exists.');

    const slug = await Groups.uniqueSlug(form.name);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const g = await client.query(
        'INSERT INTO groups (slug, name, description, emoji, owner_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [slug, form.name, form.description, form.emoji, me.id]
      );
      await client.query("INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'admin')", [g.rows[0].id, me.id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    res.redirect(`/groups/${slug}?created=1`);
  } catch (err) {
    console.error('[group create] (migration_v20.sql chali?):', err.message);
    again('Could not create the group. Please try again.');
  }
});

// ---------- INVITE LINK (WhatsApp / Facebook par share hota hai) ----------
const TOKEN_RE = /^[a-f0-9]{32}$/;

// Invite page: link kholne par group ka naam dikhta hai (share preview ke liye OG tags bhi). Join POST se hota hai.
router.get('/groups/join/:token', async (req, res, next) => {
  try {
    if (!TOKEN_RE.test(req.params.token)) return next();
    const group = await Groups.byToken(req.params.token);
    if (!group) return res.status(404).render('404', { title: 'Invite link not found' });
    const me = req.session.user ? req.session.user.id : null;
    if (me && (await Groups.roleOf(group.id, me))) return res.redirect(`/groups/${group.slug}`);
    if (!me) req.session.returnTo = `/groups/join/${req.params.token}`; // login ke baad wapas yahin
    res.render('group-invite', {
      group, token: req.params.token,
      title: `Join ${group.name}`,
      metaDescription: group.description || `Join the ${group.name} group on ${config.siteName}.`,
      ogType: 'website',
    });
  } catch (err) { next(err); }
});

router.post('/groups/join/:token', requireLogin, async (req, res, next) => {
  try {
    if (!TOKEN_RE.test(req.params.token)) return next();
    const group = await Groups.byToken(req.params.token);
    if (!group) return next();
    await pool.query(
      "INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING",
      [group.id, req.session.user.id]
    );
    res.redirect(`/groups/${group.slug}`);
  } catch (err) { next(err); }
});

// Owner (ya site admin) link reset kare: purana link band, naya ban jata hai
router.post('/groups/:slug/invite/reset', requireLogin, async (req, res, next) => {
  try {
    const group = await Groups.bySlug(req.params.slug);
    if (!group) return next();
    if (!res.locals.isAdmin && group.owner_id !== req.session.user.id) {
      return res.redirect(`/groups/${group.slug}?err=` + encodeURIComponent('Only the group owner can reset the invite link.'));
    }
    await pool.query('UPDATE groups SET invite_token = $1 WHERE id = $2', [crypto.randomBytes(16).toString('hex'), group.id]);
    res.redirect(`/groups/${group.slug}?notice=` + encodeURIComponent('Invite link reset. The old link no longer works.'));
  } catch (err) { next(err); }
});

// ---------- GROUP PAGE (uski apni feed) ----------
router.get('/groups/:slug', async (req, res, next) => {
  try {
    const group = await Groups.bySlug(req.params.slug);
    if (!group) return next();
    const me = req.session.user ? req.session.user.id : null;
    const isAdmin = res.locals.isAdmin;
    const role = await Groups.roleOf(group.id, me);
    const groupAdmin = role === 'admin';
    const before = toId(req.query.before);

    const { posts, hasMore } = await Feed.list({ me, isAdmin, groupId: group.id, before });
    await Feed.attach(posts, { me, isAdmin }, false);
    const common = { posts, f: null, ago: Feed.timeAgo, shareBase: baseUrl(req), full: false, inGroup: true, groupAdmin };

    // "Load more": sirf cards ka HTML
    if (req.query.partial === '1') {
      res.set('X-Next-Before', hasMore && posts.length ? String(posts[posts.length - 1].id) : '');
      return res.render('partials/feed-cards', common);
    }

    const members = await Groups.memberPreview(group.id, 12);
    res.render('group', {
      ...common, group, role, members,
      title: `${group.name} · Group`,
      metaDescription: group.description || `${group.name}: a group on ${config.siteName}.`,
      nextBefore: hasMore && posts.length ? posts[posts.length - 1].id : null,
      canDeleteGroup: isAdmin || (me && group.owner_id === me),
      flash: {
        created: req.query.created === '1',
        posted: req.query.posted === '1',
        deleted: req.query.deleted === '1',
        reported: req.query.reported === '1',
        notice: msg(req.query.notice),
        error: msg(req.query.err),
      },
    });
  } catch (err) { next(err); }
});

// ---------- JOIN / LEAVE ----------
router.post('/groups/:slug/join', requireLogin, async (req, res, next) => {
  try {
    const group = await Groups.bySlug(req.params.slug);
    if (!group) return next();
    await pool.query(
      "INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING",
      [group.id, req.session.user.id]
    );
    res.redirect(req.body.back === 'list' ? '/groups' : `/groups/${group.slug}`);
  } catch (err) { next(err); }
});

router.post('/groups/:slug/leave', requireLogin, async (req, res, next) => {
  try {
    const group = await Groups.bySlug(req.params.slug);
    if (!group) return next();
    const me = req.session.user.id;
    if (group.owner_id === me) {
      return res.redirect(`/groups/${group.slug}?err=` + encodeURIComponent('The owner cannot leave. Delete the group instead.'));
    }
    await pool.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [group.id, me]);
    res.redirect(req.body.back === 'list' ? '/groups' : `/groups/${group.slug}`);
  } catch (err) { next(err); }
});

// ---------- DELETE GROUP (owner ya site admin). Posts aur members saath hat jate hain ----------
router.post('/groups/:slug/delete', requireLogin, async (req, res, next) => {
  try {
    const group = await Groups.bySlug(req.params.slug);
    if (!group) return next();
    const me = req.session.user;
    if (!res.locals.isAdmin && group.owner_id !== me.id) return res.redirect(`/groups/${group.slug}?err=` + encodeURIComponent('Only the group owner can delete it.'));

    const imgs = await pool.query('SELECT image_id, user_id FROM feed_posts WHERE group_id = $1 AND image_id IS NOT NULL', [group.id]);
    await pool.query('DELETE FROM groups WHERE id = $1', [group.id]); // feed_posts, members CASCADE se jate hain
    for (const row of imgs.rows) {
      try { await Images.dropIfOrphan(row.image_id, row.user_id); } catch (e) { console.error('[group delete] image:', e.message); }
    }
    res.redirect('/groups?deleted=1');
  } catch (err) { next(err); }
});

module.exports = router;
