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
const Msg = require('../lib/messages');
const Typing = require('../lib/typing');

const router = express.Router();
const toId = (v) => (/^\d{1,9}$/.test(String(v)) ? parseInt(v, 10) : null);
const baseUrl = (req) => config.siteUrl || `${req.protocol}://${req.get('host')}`;
const oneLine = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const msg = (v) => (v ? String(v).slice(0, 200) : null);

const requireLogin = (req, res, next) => (req.session.user ? next() : res.redirect('/login'));
const requireLoginJson = (req, res, next) => (req.session.user ? next() : res.status(401).json({ error: 'Please log in again.' }));
const wantsJson = (req) => req.get('x-requested-with') === 'fetch';
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
  res.render('group-new', { title: 'Create a group', error: msg(req.query.err), form: { name: '', description: '', emoji: '', privacy: 'public' }, NAME_MAX: Groups.NAME_MAX, DESC_MAX: Groups.DESC_MAX });
});

router.post('/groups', requireLogin, async (req, res) => {
  const me = req.session.user;
  const form = { name: oneLine(req.body.name, Groups.NAME_MAX), description: oneLine(req.body.description, Groups.DESC_MAX), emoji: oneLine(req.body.emoji, 8), privacy: req.body.privacy === 'private' ? 'private' : 'public' };
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
        'INSERT INTO groups (slug, name, description, emoji, owner_id, is_private) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [slug, form.name, form.description, form.emoji, me.id, form.privacy === 'private']
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

    // Private group: andar ka hissa sirf members (aur site admin) ko. Baaqi sab ko lock wala page + join request
    if (!Groups.canView(group, role, isAdmin)) {
      if (req.query.partial === '1') return res.status(403).end();
      return res.render('group-private', {
        group, requested: await Groups.hasRequested(group.id, me),
        title: `${group.name} · Private group`,
        metaDescription: `${group.name} is a private group on ${config.siteName}.`,
        flash: { notice: msg(req.query.notice), error: msg(req.query.err) },
      });
    }

    const { posts, hasMore } = await Feed.list({ me, isAdmin, groupId: group.id, before });
    await Feed.attach(posts, { me, isAdmin }, false);
    const common = { posts, f: null, ago: Feed.timeAgo, shareBase: baseUrl(req), full: false, inGroup: true, groupAdmin };

    // "Load more": sirf cards ka HTML
    if (req.query.partial === '1') {
      res.set('X-Next-Before', hasMore && posts.length ? String(posts[posts.length - 1].id) : '');
      return res.render('partials/feed-cards', common);
    }

    const members = await Groups.memberPreview(group.id, 12);
    const canManage = groupAdmin || isAdmin;
    res.render('group', {
      ...common, group, role, members, canManage,
      pending: canManage && group.is_private ? await Groups.pendingCount(group.id) : 0,
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
    if (group.is_private) return res.redirect(`/groups/${group.slug}?notice=` + encodeURIComponent('This is a private group. Send a join request instead.'));
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

// ---------- JOIN REQUEST (private group) ----------
router.post('/groups/:slug/request', requireLogin, async (req, res, next) => {
  try {
    const group = await Groups.bySlug(req.params.slug);
    if (!group) return next();
    const me = req.session.user;
    const dest = req.body.back === 'list' ? '/groups' : `/groups/${group.slug}`;
    if (!group.is_private) {
      await pool.query(
        "INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING",
        [group.id, me.id]
      );
      return res.redirect(dest);
    }
    const st = await Groups.sendRequest(group, me);
    if (st === 'member') return res.redirect(`/groups/${group.slug}`);
    const text = {
      sent: 'Request sent. A group admin will review it.',
      already_requested: 'You already sent a request. Please wait for the admin.',
      blocked: 'You can\'t send a request to this group.',
    }[st];
    res.redirect(dest + '?notice=' + encodeURIComponent(text));
  } catch (err) { next(err); }
});

router.post('/groups/:slug/request/cancel', requireLogin, async (req, res, next) => {
  try {
    const group = await Groups.bySlug(req.params.slug);
    if (!group) return next();
    await Groups.cancelRequest(group.id, req.session.user.id);
    res.redirect(req.body.back === 'list' ? '/groups' : `/groups/${group.slug}?notice=` + encodeURIComponent('Request cancelled.'));
  } catch (err) { next(err); }
});

// ---------- MANAGE (group admin / owner / site admin): requests, add friends, remove members, privacy ----------
// Wapas { group, role, canManage, isOwner } ya null (jawab already bhej diya gaya)
async function loadManager(req, res, next) {
  const group = await Groups.bySlug(req.params.slug);
  if (!group) { next(); return null; }
  const me = req.session.user;
  const role = await Groups.roleOf(group.id, me.id);
  const canManage = role === 'admin' || res.locals.isAdmin;
  if (!canManage) {
    res.redirect(`/groups/${group.slug}?err=` + encodeURIComponent('Only group admins can manage this group.'));
    return null;
  }
  return { group, role, isOwner: group.owner_id === me.id || res.locals.isAdmin };
}

router.get('/groups/:slug/manage', requireLogin, async (req, res, next) => {
  try {
    const ctx = await loadManager(req, res, next);
    if (!ctx) return;
    const me = req.session.user;
    const [requests, members, friends] = await Promise.all([
      Groups.pendingRequests(ctx.group.id),
      Groups.allMembers(ctx.group.id),
      Groups.friendsToAdd(me.id, ctx.group.id),
    ]);
    res.render('group-manage', {
      group: ctx.group, isOwner: ctx.isOwner, requests, members, friends,
      title: `Manage ${ctx.group.name}`,
      flash: { notice: msg(req.query.notice), error: msg(req.query.err) },
    });
  } catch (err) { next(err); }
});

const manageBack = (group, key, text) => `/groups/${group.slug}/manage?${key}=` + encodeURIComponent(text);

router.post('/groups/:slug/requests/:userId/:action', requireLogin, async (req, res, next) => {
  try {
    if (req.params.action !== 'approve' && req.params.action !== 'decline') return next();
    const ctx = await loadManager(req, res, next);
    if (!ctx) return;
    const uid = toId(req.params.userId);
    const approve = req.params.action === 'approve';
    const ok = uid ? await Groups.resolveRequest(ctx.group, uid, approve) : false;
    res.redirect(ok ? manageBack(ctx.group, 'notice', approve ? 'Member added.' : 'Request declined.') : manageBack(ctx.group, 'err', 'That request is no longer pending.'));
  } catch (err) { next(err); }
});

router.post('/groups/:slug/members/add', requireLogin, async (req, res, next) => {
  try {
    const ctx = await loadManager(req, res, next);
    if (!ctx) return;
    const me = req.session.user;
    const uid = toId(req.body.user_id);
    const u = uid ? (await pool.query('SELECT id, username FROM users WHERE id = $1', [uid])).rows[0] : null;
    if (!u) return res.redirect(manageBack(ctx.group, 'err', 'Please choose a friend to add.'));
    // Sirf apne friends ko seedha add kar sakte hain (baqi log join request ya invite link se aate hain)
    if (u.id === me.id || (await Msg.canChat(me.id, u.id)) !== 'ok') {
      return res.redirect(manageBack(ctx.group, 'err', 'You can only add your own friends. Others can send a join request.'));
    }
    const added = await Groups.addMember(ctx.group, me, u);
    res.redirect(manageBack(ctx.group, added ? 'notice' : 'err', added ? `${u.username} was added.` : `${u.username} is already a member.`));
  } catch (err) { next(err); }
});

router.post('/groups/:slug/members/:userId/remove', requireLogin, async (req, res, next) => {
  try {
    const ctx = await loadManager(req, res, next);
    if (!ctx) return;
    const uid = toId(req.params.userId);
    if (!uid) return res.redirect(manageBack(ctx.group, 'err', 'Member not found.'));
    if (uid === ctx.group.owner_id) return res.redirect(manageBack(ctx.group, 'err', 'The owner cannot be removed.'));
    const role = await Groups.roleOf(ctx.group.id, uid);
    if (!role) return res.redirect(manageBack(ctx.group, 'err', 'Member not found.'));
    // Group admin sirf normal members hata sakta hai; admin ko owner / site admin
    if (role === 'admin' && !ctx.isOwner) return res.redirect(manageBack(ctx.group, 'err', 'Only the owner can remove another admin.'));
    await pool.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [ctx.group.id, uid]);
    res.redirect(manageBack(ctx.group, 'notice', 'Member removed.'));
  } catch (err) { next(err); }
});

router.post('/groups/:slug/privacy', requireLogin, async (req, res, next) => {
  try {
    const ctx = await loadManager(req, res, next);
    if (!ctx) return;
    if (!ctx.isOwner) return res.redirect(manageBack(ctx.group, 'err', 'Only the owner can change privacy.'));
    const priv = req.body.privacy === 'private';
    await pool.query('UPDATE groups SET is_private = $2 WHERE id = $1', [ctx.group.id, priv]);
    if (!priv) await pool.query('DELETE FROM group_join_requests WHERE group_id = $1', [ctx.group.id]);
    res.redirect(manageBack(ctx.group, 'notice', priv ? 'Group is now private.' : 'Group is now public.'));
  } catch (err) { next(err); }
});

// ---------- GROUP CHAT (sirf members) ----------
async function loadChat(req, res, next, json) {
  const group = await Groups.bySlug(req.params.slug);
  if (!group) { if (json) res.status(404).json({ error: 'not found' }); else next(); return null; }
  const me = req.session.user;
  const role = await Groups.roleOf(group.id, me.id);
  if (!role) {
    if (json) res.status(403).json({ error: 'Join this group to use the chat.' });
    else res.redirect(`/groups/${group.slug}?notice=` + encodeURIComponent('Join this group to use its chat.'));
    return null;
  }
  return { group, role, me };
}
const chatJson = (m, meId) => ({ id: m.id, mine: m.sender_id === meId, uid: m.sender_id, username: m.username, body: m.body, at: m.created_at });

router.get('/groups/:slug/chat', requireLogin, async (req, res, next) => {
  try {
    const ctx = await loadChat(req, res, next, false);
    if (!ctx) return;
    const messages = await Groups.chatThread(ctx.group.id, ctx.me.id);
    res.render('group-chat', {
      group: ctx.group, role: ctx.role, messages,
      lastId: messages.length ? messages[messages.length - 1].id : 0,
      canModerate: ctx.role === 'admin' || res.locals.isAdmin,
      maxLen: Msg.MAX_LEN,
      title: `${ctx.group.name} · Chat`,
      err: msg(req.query.err),
    });
  } catch (err) { next(err); }
});

router.post('/groups/:slug/chat', requireLogin, async (req, res, next) => {
  const json = wantsJson(req);
  try {
    const ctx = await loadChat(req, res, next, json);
    if (!ctx) return;
    const back = `/groups/${ctx.group.slug}/chat`;
    const fail = (text, code = 400) => (json ? res.status(code).json({ error: text }) : res.redirect(back + '?err=' + encodeURIComponent(text)));

    const c = Msg.clean(req.body.body);
    if (c.error) return fail(c.error);
    const v = await spam.check(c.body, { userId: ctx.me.id, isAdmin: res.locals.isAdmin });
    if (v.action !== 'ok') return fail('This message looks like spam, so it was not sent.');

    const m = await Groups.chatSend(ctx.group.id, ctx.me.id, c.body);
    Typing.clear(Typing.groupScope(ctx.group.id), ctx.me.id).catch(() => {});
    if (!json) return res.redirect(back + '#m' + m.id);
    res.json({ ok: true, message: chatJson({ ...m, sender_id: ctx.me.id, username: ctx.me.username, body: c.body }, ctx.me.id) });
  } catch (err) {
    console.error('[group chat send] (migration_v22.sql chali?):', err.message);
    if (json) return res.status(500).json({ error: 'Could not send. Please try again.' });
    next(err);
  }
});

router.get('/groups/:slug/chat/poll', requireLoginJson, async (req, res) => {
  try {
    const ctx = await loadChat(req, res, () => {}, true);
    if (!ctx) return;
    const scope = Typing.groupScope(ctx.group.id);
    if (req.query.typing === '1') await Typing.touch(scope, ctx.me.id);
    const after = /^\d{1,9}$/.test(String(req.query.after || '')) ? parseInt(req.query.after, 10) : 0;
    const [rows, typers] = await Promise.all([Groups.chatThread(ctx.group.id, ctx.me.id, after, 50), Typing.who(scope, ctx.me.id)]);
    res.json({ messages: rows.map((m) => chatJson(m, ctx.me.id)), typing: typers });
  } catch (err) {
    console.error('[group chat poll]', err.message);
    res.status(500).json({ error: 'server' });
  }
});

router.post('/groups/:slug/chat/:id/delete', requireLoginJson, async (req, res) => {
  try {
    const ctx = await loadChat(req, res, () => {}, true);
    if (!ctx) return;
    const id = toId(req.params.id);
    const ok = id ? await Groups.chatDelete(ctx.group.id, id, ctx.me.id, res.locals.isAdmin) : false;
    res.json({ ok });
  } catch (err) {
    console.error('[group chat delete]', err.message);
    res.status(500).json({ error: 'server' });
  }
});

module.exports = router;
