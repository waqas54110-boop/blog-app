// Raise Your Voice (V34): /petitions - petitions, signatures, updates, share card, admin milestones.
const express = require('express');
const pool = require('../db');
const config = require('../config');
const card = require('../lib/card');
const spam = require('../lib/spam');
const PT = require('../lib/petitions');
const { unusedSql } = require('../lib/images');
const { renderPetitionCard } = require('../lib/petitioncard');

const router = express.Router();
const PER_PAGE = 18;
const SPAM_MSG = 'Your text was stopped by the spam filter (links, ads or repeated text). Please rewrite it and try again.';
const toId = (v) => (/^\d{1,9}$/.test(String(v)) ? parseInt(v, 10) : null);
const oneLine = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const multiLine = (v, max) => String(v || '').replace(/\r/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const baseUrl = (req) => config.siteUrl || `${req.protocol}://${req.get('host')}`;
const requireAdmin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    return res.status(403).render('404', { code: 403, title: 'Not allowed', message: 'Only the blog owner can do this.' });
  }
  next();
};
const needLogin = (req, res, back) => { req.session.returnTo = back; res.redirect('/login'); };

// ---------- LIST ----------
router.get('/petitions', async (req, res, next) => {
  try {
    const city = req.query.city ? PT.cleanCity(req.query.city) : '';
    const cat = PT.CATEGORIES.includes(String(req.query.cat || '')) ? String(req.query.cat) : '';
    const sort = ['trending', 'new', 'top'].includes(req.query.sort) ? req.query.sort : 'trending';
    const won = req.query.status === 'won';
    const q = oneLine(req.query.q, 60);
    const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), 200);
    const where = ['NOT p.is_hidden', won ? "p.status = 'resolved'" : "p.status = 'active'"];
    const params = [];
    if (city) { params.push(city.toLowerCase()); where.push(`lower(p.city) = $${params.length}`); }
    if (cat) { params.push(cat); where.push(`p.category = $${params.length}`); }
    if (q) {
      params.push('%' + q.replace(/[%_\\]/g, (m) => '\\' + m) + '%');
      where.push(`(p.title ILIKE $${params.length} OR p.city ILIKE $${params.length} OR COALESCE(p.area, '') ILIKE $${params.length})`);
    }
    const order = sort === 'new' ? 'p.created_at DESC, p.id DESC' : sort === 'top' ? 'p.sign_count DESC, p.id DESC' : 'recent DESC, p.sign_count DESC, p.id DESC';
    params.push(PER_PAGE, (page - 1) * PER_PAGE);
    const r = await pool.query(
      `SELECT p.id, p.title, p.city, p.area, p.category, p.image_id, p.status, p.sign_count, p.created_at, u.username,
              (SELECT COUNT(*)::int FROM petition_signatures s WHERE s.petition_id = p.id AND s.created_at > now() - interval '48 hours') AS recent,
              COUNT(*) OVER()::int AS total
         FROM petitions p JOIN users u ON u.id = p.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const total = r.rows[0] ? r.rows[0].total : 0;
    const [stats, cities] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS petitions, COALESCE(SUM(sign_count), 0)::int AS signatures,
                COUNT(*) FILTER (WHERE status = 'resolved')::int AS won
           FROM petitions WHERE NOT is_hidden`),
      pool.query(
        `SELECT MIN(city) AS city, COUNT(*)::int AS n FROM petitions
          WHERE NOT is_hidden AND status = 'active' GROUP BY lower(city) ORDER BY n DESC, MIN(city) LIMIT 12`),
    ]);
    res.render('petitions', {
      title: city ? `Petitions in ${city} - Raise Your Voice` : 'Raise Your Voice - Local petitions in Pakistan',
      metaDescription: 'Start a petition for your street, neighbourhood or city and collect signatures. Broken roads, water, gas, schools: make it impossible to ignore.',
      petitions: r.rows, total, page, pages: Math.max(1, Math.ceil(total / PER_PAGE)),
      f: { city, cat, sort, won, q }, stats: stats.rows[0], cities: cities.rows, categories: PT.CATEGORIES, goalOf: PT.nextGoal,
      ogImage: card.isAvailable() ? baseUrl(req) + '/og/petitions.png' : null,
      ogImageCard: card.isAvailable(),
      msg: req.query.msg ? String(req.query.msg).slice(0, 200) : null,
    });
  } catch (err) { next(err); }
});

router.get('/og/petitions.png', async (req, res) => {
  if (!card.isAvailable()) return res.status(404).end();
  try {
    const png = await card.renderCard({ title: 'Raise Your Voice: start a petition for your area', category: 'Petitions', siteName: config.siteName, meta: 'Sign. Share. Get it fixed.' });
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('image/png').send(png);
  } catch (err) { console.error('[petitions og]', err.message); res.status(404).end(); }
});

// ---------- NAYI PETITION ----------
router.get('/petitions/new', (req, res) => {
  if (!req.session.user) return needLogin(req, res, '/petitions/new');
  res.render('petition-new', { title: 'Start a petition', error: req.query.error || null, categories: PT.CATEGORIES, cities: PT.CITIES, f: {} });
});

router.post('/petitions', async (req, res, next) => {
  try {
    if (!req.session.user) return needLogin(req, res, '/petitions/new');
    const me = req.session.user;
    const b = req.body || {};
    const f = { title: oneLine(b.title, 120), body: multiLine(b.body, 1500), city: PT.cleanCity(b.city), area: oneLine(b.area, 80), category: String(b.category || '') };
    const imageId = toId(b.image_id);
    const fail = (m) => res.status(400).render('petition-new', {
      title: 'Start a petition', error: m, categories: PT.CATEGORIES, cities: PT.CITIES, f: { ...f, image_id: imageId || '' },
    });
    if (f.title.length < 10) return fail('Please write a clear title (at least 10 characters).');
    if (f.body.length < 60) return fail('Please describe the problem in at least 60 characters: what is wrong, where, and since when.');
    if (f.city.length < 2) return fail('Please enter your city.');
    if (!PT.CATEGORIES.includes(f.category)) return fail('Please choose a category.');
    const v = await spam.check(f.title + '\n' + f.body, { userId: me.id, isAdmin: me.role === 'admin' });
    if (v.action !== 'ok') return fail(SPAM_MSG);
    if (me.role !== 'admin') {
      const lim = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS day,
                COUNT(*) FILTER (WHERE status = 'active')::int AS active
           FROM petitions WHERE user_id = $1`, [me.id]);
      if (lim.rows[0].day >= 3) return fail('You can start up to 3 petitions per day. Please try again tomorrow.');
      if (lim.rows[0].active >= 10) return fail('You already have 10 active petitions. Close or resolve one before starting another.');
    }
    let img = null;
    if (imageId) {
      const ok = await pool.query(`SELECT id FROM images WHERE id = $1 AND uploaded_by = $2 AND ${unusedSql('$1')}`, [imageId, me.id]);
      if (!ok.rows[0]) return fail('That photo could not be used. Please upload it again.');
      img = imageId;
    }
    const cl = await pool.connect();
    let id;
    try {
      await cl.query('BEGIN');
      const ins = await cl.query(
        `INSERT INTO petitions (user_id, title, body, city, area, category, image_id, sign_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1) RETURNING id`,
        [me.id, f.title, f.body, f.city, f.area || null, f.category, img]
      );
      id = ins.rows[0].id;
      await cl.query('INSERT INTO petition_signatures (petition_id, user_id) VALUES ($1, $2)', [id, me.id]);
      await cl.query('COMMIT');
    } catch (e) {
      try { await cl.query('ROLLBACK'); } catch (e2) { /* ignore */ }
      throw e;
    } finally { cl.release(); }
    res.redirect(`/petitions/${id}?created=1`);
  } catch (err) { next(err); }
});

// ---------- SHARE CARD ----------
router.get(/^\/og\/petition\/(\d{1,9})\.png$/, async (req, res) => {
  if (!card.isAvailable()) return res.status(404).end();
  try {
    const r = await pool.query('SELECT * FROM petitions WHERE id = $1 AND NOT is_hidden', [parseInt(req.params[0], 10)]);
    if (!r.rows[0]) return res.status(404).end();
    const png = await renderPetitionCard(r.rows[0], config.siteName);
    res.set('Cache-Control', 'public, max-age=300');
    if (req.query.dl === '1' && req.session.user && req.session.user.role === 'admin') {
      res.set('Content-Disposition', `attachment; filename="petition-${r.rows[0].id}-${r.rows[0].sign_count}.png"`);
    }
    res.type('image/png').send(png);
  } catch (err) { console.error('[petition card]', err.message); res.status(404).end(); }
});

// ---------- DETAIL ----------
router.get('/petitions/:id', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return next();
    const me = req.session.user || null;
    const uid = me ? me.id : null;
    const isAdmin = res.locals.isAdmin;

    let notice = null;
    if (req.session.pendingSign === id && uid) {
      delete req.session.pendingSign;
      const r = await PT.sign(id, uid);
      notice = r.error || 'Thank you! Your signature has been added. Now share it so others can sign too.';
    }

    const pr = await pool.query('SELECT p.*, u.username FROM petitions p JOIN users u ON u.id = p.user_id WHERE p.id = $1', [id]);
    const p = pr.rows[0];
    if (!p || (p.is_hidden && !isAdmin && p.user_id !== uid)) return next();

    const [signed, recent, updates, today] = await Promise.all([
      uid ? pool.query('SELECT 1 FROM petition_signatures WHERE petition_id = $1 AND user_id = $2', [id, uid]) : { rows: [] },
      pool.query(`SELECT u.username, s.created_at FROM petition_signatures s JOIN users u ON u.id = s.user_id WHERE s.petition_id = $1 ORDER BY s.created_at DESC LIMIT 12`, [id]),
      pool.query('SELECT body, created_at FROM petition_updates WHERE petition_id = $1 ORDER BY id DESC LIMIT 20', [id]),
      pool.query("SELECT COUNT(*)::int AS n FROM petition_signatures WHERE petition_id = $1 AND created_at > now() - interval '24 hours'", [id]),
    ]);

    if (!notice && req.query.created) notice = 'Your petition is live! Share it in your area\'s WhatsApp groups to collect your first signatures.';
    if (!notice && req.query.error) notice = String(req.query.error).slice(0, 200);
    if (!notice && req.query.signed) notice = 'Thank you! Your signature has been added. Now share it so others can sign too.';
    if (!notice && req.query.posted) notice = 'Update posted. Everyone who signed has been notified.';

    const base = baseUrl(req);
    const url = `${base}/petitions/${id}`;
    const utm = (src) => `${url}?utm_source=${src}&utm_medium=share`;
    const where = [p.area, p.city].filter(Boolean).join(', ');
    const waText = `📢 ${p.title}\n📍 ${where}\n\n${p.sign_count} ${p.sign_count === 1 ? 'person has' : 'people have'} signed. Add your name 👉 ${utm('whatsapp')}`;
    const goal = PT.nextGoal(p.sign_count);
    res.render('petition', {
      p, where, goal, notice,
      pct: Math.max(2, Math.min(100, Math.round((p.sign_count * 100) / goal))),
      signed: !!signed.rows[0], isOwner: uid === p.user_id,
      recent: recent.rows, updates: updates.rows, today: today.rows[0].n,
      title: `${p.title} - ${p.city} petition`,
      metaDescription: `${p.sign_count} signatures so far. ${p.body.replace(/\s+/g, ' ').slice(0, 140)}`,
      ogImage: card.isAvailable() ? `${base}/og/petition/${id}.png` : (p.image_id ? `${base}/img/${p.image_id}` : null),
      ogImageCard: card.isAvailable(),
      shareUrls: { whatsapp: utm('whatsapp'), facebook: utm('facebook'), x: utm('x'), copy: utm('link') },
      waText,
    });
  } catch (err) { next(err); }
});

// ---------- SIGN / UNSIGN ----------
router.post('/petitions/:id/sign', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.redirect('/petitions');
    if (!req.session.user) { req.session.pendingSign = id; return needLogin(req, res, '/petitions/' + id); }
    const r = await PT.sign(id, req.session.user.id);
    res.redirect(`/petitions/${id}` + (r.error ? '?error=' + encodeURIComponent(r.error) : '?signed=1') + '#sign');
  } catch (err) { next(err); }
});

router.post('/petitions/:id/unsign', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.redirect('/petitions');
    if (!req.session.user) return needLogin(req, res, '/petitions/' + id);
    await PT.unsign(id, req.session.user.id);
    res.redirect('/petitions/' + id);
  } catch (err) { next(err); }
});

// ---------- CREATOR: update, resolve, close ----------
async function ownerOrAdmin(req, id) {
  if (!req.session.user) return null;
  const r = await pool.query('SELECT id, user_id, title, status FROM petitions WHERE id = $1', [id]);
  const p = r.rows[0];
  if (!p) return null;
  return p.user_id === req.session.user.id || req.session.user.role === 'admin' ? p : null;
}

router.post('/petitions/:id/update', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.redirect('/petitions');
    const p = await ownerOrAdmin(req, id);
    if (!p) return res.redirect('/petitions/' + id);
    const text = multiLine(req.body.body, 600);
    const back = (m) => res.redirect(`/petitions/${id}?error=${encodeURIComponent(m)}#updates`);
    if (p.status !== 'active') return back('Updates can only be posted on active petitions.');
    if (text.length < 10) return back('Please write at least 10 characters.');
    const v = await spam.check(text, { userId: req.session.user.id, isAdmin: req.session.user.role === 'admin' });
    if (v.action !== 'ok') return back(SPAM_MSG);
    await pool.query('INSERT INTO petition_updates (petition_id, user_id, body) VALUES ($1, $2, $3)', [id, req.session.user.id, text]);
    await PT.notifySigners(id, `Update on "${PT.short(p.title, 60)}": ${text.replace(/\s+/g, ' ')}`, req.session.user.id);
    res.redirect(`/petitions/${id}?posted=1#updates`);
  } catch (err) { next(err); }
});

router.post('/petitions/:id/resolve', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.redirect('/petitions');
    const p = await ownerOrAdmin(req, id);
    if (!p || p.status !== 'active') return res.redirect('/petitions/' + id);
    const outcome = oneLine(req.body.outcome, 500);
    if (outcome) {
      const v = await spam.check(outcome, { userId: req.session.user.id, isAdmin: req.session.user.role === 'admin' });
      if (v.action !== 'ok') return res.redirect(`/petitions/${id}?error=${encodeURIComponent(SPAM_MSG)}`);
    }
    await pool.query("UPDATE petitions SET status = 'resolved', outcome = $2, updated_at = now() WHERE id = $1", [id, outcome || null]);
    await PT.notifySigners(id, `Good news! "${PT.short(p.title, 70)}" has been marked as resolved. Thank you for signing.`, req.session.user.id);
    res.redirect('/petitions/' + id);
  } catch (err) { next(err); }
});

router.post('/petitions/:id/close', async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.redirect('/petitions');
    const p = await ownerOrAdmin(req, id);
    if (p && p.status === 'active') await pool.query("UPDATE petitions SET status = 'closed', updated_at = now() WHERE id = $1", [id]);
    res.redirect('/petitions/' + id);
  } catch (err) { next(err); }
});

router.post('/petitions/:id/share', (req, res) => {
  const id = toId(req.params.id);
  if (id) pool.query('UPDATE petitions SET shares = shares + 1 WHERE id = $1', [id]).catch(() => {});
  res.status(204).end();
});

// ---------- ADMIN ----------
router.post('/petitions/:id/hide', requireAdmin, async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (id) await pool.query('UPDATE petitions SET is_hidden = NOT is_hidden WHERE id = $1', [id]);
    res.redirect(req.body.back === 'admin' ? '/admin/petitions' : '/petitions/' + id);
  } catch (err) { next(err); }
});

router.post('/petitions/:id/delete', requireAdmin, async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (id) {
      const d = await pool.query('DELETE FROM petitions WHERE id = $1 RETURNING image_id, user_id', [id]);
      if (d.rows[0] && d.rows[0].image_id) await require('../lib/images').dropIfOrphan(d.rows[0].image_id, d.rows[0].user_id);
    }
    res.redirect(req.body.back === 'admin' ? '/admin/petitions' : '/petitions?msg=' + encodeURIComponent('Petition deleted.'));
  } catch (err) { next(err); }
});

router.get('/admin/petitions', requireAdmin, async (req, res, next) => {
  try {
    const rows = (await pool.query(
      `SELECT p.id, p.title, p.city, p.area, p.category, p.status, p.sign_count, p.milestone_posted, p.is_hidden, p.shares, p.created_at, u.username
         FROM petitions p JOIN users u ON u.id = p.user_id
        WHERE p.sign_count >= $1 AND NOT p.is_hidden ORDER BY p.sign_count DESC LIMIT 200`, [PT.ADMIN_POST_FROM]
    )).rows;
    const base = baseUrl(req);
    const ready = rows
      .filter((p) => PT.reached(p.sign_count) > p.milestone_posted)
      .map((p) => {
        const m = PT.reached(p.sign_count);
        const where = [p.area, p.city].filter(Boolean).join(', ');
        const caption = `${m}+ people in ${p.city} have signed: "${p.title}"\n\nRead it and add your name 👉 ${base}/petitions/${p.id}?utm_source=social&utm_medium=milestone\n\n#${p.city.replace(/[^A-Za-z0-9]/g, '')} #${config.siteName.replace(/[^A-Za-z0-9]/g, '')}`;
        return { ...p, milestone: m, where, caption };
      });
    const recent = (await pool.query(
      `SELECT p.id, p.title, p.city, p.status, p.sign_count, p.is_hidden, p.shares, p.created_at, u.username
         FROM petitions p JOIN users u ON u.id = p.user_id ORDER BY p.id DESC LIMIT 40`
    )).rows;
    res.render('admin-petitions', { title: 'Petition milestones', ready, recent, cardOk: card.isAvailable() });
  } catch (err) { next(err); }
});

router.post('/admin/petitions/:id/posted', requireAdmin, async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (id) await pool.query(
      `UPDATE petitions SET milestone_posted = (SELECT CASE WHEN sign_count >= 100000 THEN 100000 WHEN sign_count >= 50000 THEN 50000 WHEN sign_count >= 25000 THEN 25000 WHEN sign_count >= 10000 THEN 10000 WHEN sign_count >= 5000 THEN 5000 WHEN sign_count >= 2500 THEN 2500 WHEN sign_count >= 1000 THEN 1000 WHEN sign_count >= 500 THEN 500 WHEN sign_count >= 250 THEN 250 WHEN sign_count >= 100 THEN 100 ELSE 0 END FROM petitions WHERE id = $1) WHERE id = $1`, [id]);
    res.redirect('/admin/petitions');
  } catch (err) { next(err); }
});

module.exports = router;
