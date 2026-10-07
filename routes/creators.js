// Creator Showcase (V38): /creators - creators share a YouTube / TikTok link, the community likes,
// comments, gives feedback, votes "Creator of the Week" and (if they want) visits / subscribes.
// No points, no rewards for subscribing: this keeps it inside YouTube's rules.
const express = require('express');
const pool = require('../db');
const config = require('../config');
const spam = require('../lib/spam');
const CR = require('../lib/creators');
const { notifyUser } = require('../lib/notify');

const router = express.Router();
const PER_PAGE = 18;
const TZ = config.timezone || 'Asia/Karachi';
const SPAM_MSG = 'Your text was stopped by the spam filter (links, ads or repeated text). Please rewrite it and try again.';
const toId = (v) => (/^\d{1,9}$/.test(String(v)) ? parseInt(v, 10) : null);
const oneLine = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const multiLine = (v, max) => String(v || '').replace(/\r/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const needLogin = (req, res, back) => { req.session.returnTo = back; res.redirect('/login'); };
const WEEK = CR.weekStartSql('$1'); // $1 = timezone

const POST_COLS = `p.id, p.user_id, p.platform, p.kind, p.url, p.yt_video_id, p.title, p.description, p.niche,
  p.like_count, p.comment_count, p.clicks, p.created_at, u.username`;

// ---------- LIST + Creator of the Week ----------
router.get('/creators', async (req, res, next) => {
  try {
    const niche = CR.NICHES.includes(String(req.query.niche || '')) ? String(req.query.niche) : '';
    const platform = ['youtube', 'tiktok'].includes(req.query.platform) ? req.query.platform : '';
    const sort = ['new', 'top', 'week'].includes(req.query.sort) ? req.query.sort : 'new';
    const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), 200);
    const where = ['NOT p.is_hidden'];
    const params = [TZ];
    if (niche) { params.push(niche); where.push(`p.niche = $${params.length}`); }
    if (platform) { params.push(platform); where.push(`p.platform = $${params.length}`); }
    const order = sort === 'top' ? 'p.like_count DESC, p.id DESC' : sort === 'week' ? 'wk DESC, p.id DESC' : 'p.created_at DESC, p.id DESC';
    params.push(PER_PAGE, (page - 1) * PER_PAGE);
    const r = await pool.query(
      `SELECT ${POST_COLS},
              (SELECT COUNT(*)::int FROM creator_votes v WHERE v.post_id = p.id AND v.week_start = ${WEEK}) AS wk,
              COUNT(*) OVER()::int AS total
         FROM creator_posts p JOIN users u ON u.id = p.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const total = r.rows[0] ? r.rows[0].total : 0;

    // Is hafte ki leaderboard (top 5) + pichle hafte ka winner
    const [board, last, stats] = await Promise.all([
      pool.query(
        `SELECT p.id, p.title, p.platform, u.username, COUNT(v.user_id)::int AS votes
           FROM creator_votes v JOIN creator_posts p ON p.id = v.post_id AND NOT p.is_hidden
           JOIN users u ON u.id = p.user_id
          WHERE v.week_start = ${WEEK}
          GROUP BY p.id, u.username ORDER BY votes DESC, p.id DESC LIMIT 5`, [TZ]),
      pool.query(
        `SELECT p.id, p.title, p.platform, u.username, COUNT(v.user_id)::int AS votes
           FROM creator_votes v JOIN creator_posts p ON p.id = v.post_id AND NOT p.is_hidden
           JOIN users u ON u.id = p.user_id
          WHERE v.week_start = ${WEEK} - 7
          GROUP BY p.id, u.username ORDER BY votes DESC, p.id ASC LIMIT 1`, [TZ]),
      pool.query(`SELECT COUNT(*)::int AS creators, COALESCE(SUM(comment_count), 0)::int AS comments FROM creator_posts WHERE NOT is_hidden`),
    ]);
    let myVote = null;
    if (req.session.user) {
      const mv = await pool.query(`SELECT post_id FROM creator_votes WHERE user_id = $2 AND week_start = ${WEEK}`, [TZ, req.session.user.id]);
      myVote = mv.rows[0] ? mv.rows[0].post_id : null;
    }
    res.render('creators', {
      title: 'Creator Showcase - Discover new YouTube and TikTok creators',
      metaDescription: 'Share your YouTube or TikTok channel, get honest feedback from real people and compete for Creator of the Week. No fake subscribers, no tricks.',
      posts: r.rows, total, page, pages: Math.max(1, Math.ceil(total / PER_PAGE)),
      f: { niche, platform, sort }, niches: CR.NICHES,
      board: board.rows, lastWinner: last.rows[0] || null, stats: stats.rows[0], myVote,
      msg: req.query.msg ? String(req.query.msg).slice(0, 200) : null,
    });
  } catch (err) { next(err); }
});

// ---------- NEW ----------
router.get('/creators/new', (req, res) => {
  if (!req.session.user) return needLogin(req, res, '/creators/new');
  res.render('creator-new', { title: 'Share your channel', error: req.query.error || null, niches: CR.NICHES, f: {} });
});

router.post('/creators', async (req, res, next) => {
  try {
    if (!req.session.user) return needLogin(req, res, '/creators/new');
    const me = req.session.user;
    const b = req.body || {};
    const f = { link: oneLine(b.link, 300), title: oneLine(b.title, 100), description: multiLine(b.description, 600), niche: String(b.niche || '') };
    const fail = (m) => res.status(400).render('creator-new', { title: 'Share your channel', error: m, niches: CR.NICHES, f });
    const lk = CR.parseLink(f.link);
    if (!lk.ok) return fail(lk.error);
    if (f.title.length < 5) return fail('Please write a title (at least 5 characters), for example your channel name and what it is about.');
    if (f.description.length < 30) return fail('Please tell people what your content is about in at least 30 characters.');
    if (!CR.NICHES.includes(f.niche)) return fail('Please choose a niche.');
    const v = await spam.check(f.title + '\n' + f.description, { userId: me.id, isAdmin: me.role === 'admin' });
    if (v.action !== 'ok') return fail(SPAM_MSG);
    if (me.role !== 'admin') {
      const lim = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS day, COUNT(*)::int AS total
           FROM creator_posts WHERE user_id = $1 AND NOT is_hidden`, [me.id]);
      if (lim.rows[0].day >= 3) return fail('You can share up to 3 links per day. Please try again tomorrow.');
      if (lim.rows[0].total >= 10) return fail('You already have 10 links in the showcase. Delete an old one first.');
    }
    const dup = await pool.query('SELECT id FROM creator_posts WHERE lower(url) = lower($1) AND NOT is_hidden LIMIT 1', [lk.url]);
    if (dup.rows[0]) return res.redirect('/creators/' + dup.rows[0].id + '?msg=' + encodeURIComponent('This link is already in the showcase.'));
    const ins = await pool.query(
      `INSERT INTO creator_posts (user_id, platform, kind, url, yt_video_id, title, description, niche)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [me.id, lk.platform, lk.kind, lk.url, lk.ytVideoId, f.title, f.description, f.niche]);
    res.redirect('/creators/' + ins.rows[0].id);
  } catch (err) { next(err); }
});

// ---------- DETAIL ----------
router.get('/creators/:id', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return next();
    const r = await pool.query(
      `SELECT ${POST_COLS},
              (SELECT COUNT(*)::int FROM creator_votes v WHERE v.post_id = p.id AND v.week_start = ${WEEK}) AS wk
         FROM creator_posts p JOIN users u ON u.id = p.user_id
        WHERE p.id = $2 AND NOT p.is_hidden`, [TZ, id]);
    const p = r.rows[0];
    if (!p) return next();
    const me = req.session.user || null;
    const [cm, liked, voted, tot] = await Promise.all([
      pool.query(
        `SELECT c.id, c.user_id, c.kind, c.body, c.created_at, u.username
           FROM creator_comments c JOIN users u ON u.id = c.user_id
          WHERE c.post_id = $1 AND NOT c.is_hidden ORDER BY c.created_at ASC LIMIT 200`, [id]),
      me ? pool.query('SELECT 1 FROM creator_likes WHERE post_id = $1 AND user_id = $2', [id, me.id]) : { rows: [] },
      me ? pool.query(`SELECT post_id FROM creator_votes WHERE user_id = $2 AND week_start = ${WEEK}`, [TZ, me.id]) : { rows: [] },
      pool.query(`SELECT COUNT(*)::int AS n FROM creator_votes WHERE post_id = $1`, [id]),
    ]);
    res.render('creator', {
      title: p.title + ' - Creator Showcase',
      metaDescription: p.description.slice(0, 155),
      p, comments: cm.rows, liked: !!liked.rows[0], myVote: voted.rows[0] ? voted.rows[0].post_id : null,
      allVotes: tot.rows[0].n, actionUrl: CR.actionUrl(p),
      msg: req.query.msg ? String(req.query.msg).slice(0, 200) : null,
      error: req.query.error ? String(req.query.error).slice(0, 200) : null,
    });
  } catch (err) { next(err); }
});

// ---------- LIKE (toggle) ----------
router.post('/creators/:id/like', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.redirect('/creators');
    if (!req.session.user) return needLogin(req, res, '/creators/' + id);
    const me = req.session.user;
    const ex = await pool.query('SELECT id FROM creator_posts WHERE id = $1 AND NOT is_hidden', [id]);
    if (!ex.rows[0]) return res.redirect('/creators');
    const del = await pool.query('DELETE FROM creator_likes WHERE post_id = $1 AND user_id = $2', [id, me.id]);
    if (del.rowCount === 0) await pool.query('INSERT INTO creator_likes (post_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, me.id]);
    await pool.query('UPDATE creator_posts SET like_count = (SELECT COUNT(*)::int FROM creator_likes WHERE post_id = $1) WHERE id = $1', [id]);
    res.redirect('/creators/' + id);
  } catch (err) { next(err); }
});

// ---------- COMMENT / FEEDBACK ----------
router.post('/creators/:id/comments', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.redirect('/creators');
    if (!req.session.user) return needLogin(req, res, '/creators/' + id);
    const me = req.session.user;
    const back = (m, key) => res.redirect('/creators/' + id + '?' + (key || 'error') + '=' + encodeURIComponent(m) + '#talk');
    const kind = req.body.kind === 'feedback' ? 'feedback' : 'comment';
    const body = multiLine(req.body.body, 800);
    if (body.length < (kind === 'feedback' ? 30 : 2)) return back(kind === 'feedback' ? 'Feedback needs at least 30 characters: say what works and what could be better.' : 'Please write a comment.');
    const pr = await pool.query('SELECT user_id, title FROM creator_posts WHERE id = $1 AND NOT is_hidden', [id]);
    if (!pr.rows[0]) return res.redirect('/creators');
    const v = await spam.check(body, { userId: me.id, isAdmin: me.role === 'admin' });
    if (v.action !== 'ok') return back(SPAM_MSG);
    await pool.query('INSERT INTO creator_comments (post_id, user_id, kind, body) VALUES ($1,$2,$3,$4)', [id, me.id, kind, body]);
    await pool.query('UPDATE creator_posts SET comment_count = (SELECT COUNT(*)::int FROM creator_comments WHERE post_id = $1 AND NOT is_hidden) WHERE id = $1', [id]);
    if (pr.rows[0].user_id !== me.id) {
      notifyUser(pr.rows[0].user_id, `${me.username} left ${kind === 'feedback' ? 'feedback' : 'a comment'} on "${pr.rows[0].title}"`, '/creators/' + id + '#talk');
    }
    back(kind === 'feedback' ? 'Thanks, your feedback was posted.' : 'Comment posted.', 'msg');
  } catch (err) { next(err); }
});

router.post('/creators/comments/:cid/delete', async (req, res, next) => {
  try {
    const cid = toId(req.params.cid);
    if (!req.session.user || !cid) return res.redirect('/login');
    const me = req.session.user;
    const r = await pool.query(
      `SELECT c.id, c.post_id, c.user_id, p.user_id AS owner FROM creator_comments c JOIN creator_posts p ON p.id = c.post_id WHERE c.id = $1`, [cid]);
    const c = r.rows[0];
    if (!c) return res.redirect('/creators');
    if (me.role !== 'admin' && me.id !== c.user_id && me.id !== c.owner) return res.status(403).render('404', { code: 403, title: 'Not allowed', message: 'You cannot delete this comment.' });
    await pool.query('DELETE FROM creator_comments WHERE id = $1', [cid]);
    await pool.query('UPDATE creator_posts SET comment_count = (SELECT COUNT(*)::int FROM creator_comments WHERE post_id = $1 AND NOT is_hidden) WHERE id = $1', [c.post_id]);
    res.redirect('/creators/' + c.post_id + '#talk');
  } catch (err) { next(err); }
});

// ---------- VOTE: Creator of the Week (1 vote per user per week, not for yourself) ----------
router.post('/creators/:id/vote', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.redirect('/creators');
    if (!req.session.user) return needLogin(req, res, '/creators/' + id);
    const me = req.session.user;
    const go = (m, key) => res.redirect('/creators/' + id + '?' + (key || 'error') + '=' + encodeURIComponent(m));
    const pr = await pool.query('SELECT user_id FROM creator_posts WHERE id = $1 AND NOT is_hidden', [id]);
    if (!pr.rows[0]) return res.redirect('/creators');
    if (pr.rows[0].user_id === me.id) return go('You cannot vote for your own channel.');
    // Naye account se vote dhandli rokne ke liye: account kam az kam 1 din purani ho
    const age = await pool.query(`SELECT (created_at < now() - interval '1 day') AS old FROM users WHERE id = $1`, [me.id]);
    if (age.rows[0] && age.rows[0].old === false) return go('New accounts can vote after 24 hours. Please come back tomorrow.');
    const ins = await pool.query(
      `INSERT INTO creator_votes (week_start, user_id, post_id) VALUES (${WEEK}, $2, $3) ON CONFLICT (week_start, user_id) DO NOTHING`,
      [TZ, me.id, id]);
    if (ins.rowCount === 0) return go('You already used your vote this week. A new week starts on Monday.');
    go('Your Creator of the Week vote is counted. Thank you!', 'msg');
  } catch (err) { next(err); }
});

// ---------- VISIT / SUBSCRIBE (voluntary; just counts the click) ----------
router.get('/creators/:id/go', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return next();
    const r = await pool.query('UPDATE creator_posts SET clicks = clicks + 1 WHERE id = $1 AND NOT is_hidden RETURNING platform, kind, url', [id]);
    if (!r.rows[0]) return next();
    res.set('Referrer-Policy', 'no-referrer');
    res.redirect(302, CR.actionUrl(r.rows[0]));
  } catch (err) { next(err); }
});

// ---------- DELETE ----------
router.post('/creators/:id/delete', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!req.session.user || !id) return res.redirect('/login');
    const me = req.session.user;
    const r = await pool.query('SELECT user_id FROM creator_posts WHERE id = $1', [id]);
    if (!r.rows[0]) return res.redirect('/creators');
    if (me.role !== 'admin' && r.rows[0].user_id !== me.id) return res.status(403).render('404', { code: 403, title: 'Not allowed', message: 'You cannot delete this.' });
    await pool.query('DELETE FROM creator_posts WHERE id = $1', [id]);
    res.redirect('/creators?msg=' + encodeURIComponent('Deleted.'));
  } catch (err) { next(err); }
});

module.exports = router;
