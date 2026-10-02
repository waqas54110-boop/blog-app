// "Report" button (comment / contest comment / contest) aur admin ki moderation queue + spam words.
const express = require('express');
const pool = require('../db');
const M = require('../lib/moderation');
const spam = require('../lib/spam');

const router = express.Router();
const toId = (v) => (/^\d{1,9}$/.test(String(v)) ? parseInt(v, 10) : null);
const oneLine = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const requireLogin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  next();
};
const requireAdmin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    return res.status(403).render('404', { code: 403, title: 'Not allowed', message: 'Only the blog owner can do this.' });
  }
  next();
};

// Content ka owner + wapas jane ka link (ret form se nahi aata, server khud banata hai)
async function lookup(type, id, meId) {
  if (type === 'user') {
    const r = await pool.query('SELECT id, username FROM users WHERE id = $1', [id]);
    return r.rows[0] ? { owner: r.rows[0].id, path: `/u/${encodeURIComponent(r.rows[0].username)}`, hash: '' } : null;
  }
  if (type === 'message') {
    // Sirf wahi report kar sakta hai jise message aaya (doosre ki private chat report nahi hoti)
    const r = await pool.query(
      'SELECT m.sender_id AS owner, m.receiver_id, s.username FROM messages m JOIN users s ON s.id = m.sender_id WHERE m.id = $1', [id]);
    const m = r.rows[0];
    return m && m.receiver_id === meId ? { owner: m.owner, path: `/messages/${encodeURIComponent(m.username)}`, hash: `#m${id}` } : null;
  }
  if (type === 'comment') {
    const r = await pool.query('SELECT c.user_id AS owner, p.slug FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id = $1', [id]);
    return r.rows[0] ? { owner: r.rows[0].owner, path: `/posts/${r.rows[0].slug}`, hash: `#c${id}` } : null;
  }
  if (type === 'poll_comment') {
    const r = await pool.query('SELECT user_id AS owner, poll_id FROM poll_comments WHERE id = $1', [id]);
    return r.rows[0] ? { owner: r.rows[0].owner, path: `/votes/${r.rows[0].poll_id}`, hash: `#c${id}` } : null;
  }
  const r = await pool.query('SELECT created_by AS owner FROM polls WHERE id = $1', [id]);
  return r.rows[0] ? { owner: r.rows[0].owner, path: `/votes/${id}`, hash: '' } : null;
}

// ---------- USER: report karna ----------
router.post('/report', requireLogin, async (req, res, next) => {
  try {
    const type = String(req.body.type || '');
    const id = toId(req.body.id);
    const reason = String(req.body.reason || '');
    if (!M.TYPES.includes(type) || !id || !M.REASONS.includes(reason)) return res.redirect('/');

    const me = req.session.user;
    const t = await lookup(type, id, me.id);
    if (!t) return res.redirect('/');
    if (t.owner === me.id) return res.redirect(t.path + t.hash); // apna content report nahi hota

    const ins = await pool.query(
      `INSERT INTO reports (reporter_id, target_type, target_id, reason, details) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING RETURNING id`,
      [me.id, type, id, reason, oneLine(req.body.details, 300) || null]
    );

    // Kai alag logon ne report kiya to comment foran chhupa do (admin dekh kar wapas la sakta hai)
    if (ins.rows[0] && (type === 'comment' || type === 'poll_comment')) {
      const table = type === 'comment' ? 'comments' : 'poll_comments';
      const n = await pool.query(
        `SELECT COUNT(DISTINCT reporter_id)::int AS c FROM reports
         WHERE target_type = $1 AND target_id = $2 AND status = 'open' AND reporter_id IS NOT NULL`,
        [type, id]
      );
      if (n.rows[0].c >= M.AUTOHIDE) await pool.query(`UPDATE ${table} SET is_hidden = true WHERE id = $1`, [id]);
    }
    res.redirect(`${t.path}?reported=1${t.hash}`);
  } catch (err) { next(err); }
});

// ---------- ADMIN: queue ----------
router.get('/admin/moderation', requireAdmin, async (req, res, next) => {
  try {
    const [groups, handled, words] = await Promise.all([M.openGroups(), M.recentHandled(), spam.getWords()]);
    res.render('moderation', {
      title: 'Moderation',
      groups, handled, words,
      autohide: M.AUTOHIDE,
      notice: req.query.msg ? String(req.query.msg).slice(0, 200) : null,
    });
  } catch (err) { next(err); }
});

// action: delete (comment hatao) | keep (theek hai, reports band, hidden ho to wapas) | close (contest band karo)
router.post('/admin/moderation/act', requireAdmin, async (req, res, next) => {
  try {
    const type = String(req.body.type || '');
    const id = toId(req.body.id);
    const action = String(req.body.action || '');
    const me = req.session.user.id;
    const done = (msg) => res.redirect('/admin/moderation?msg=' + encodeURIComponent(msg));
    if (!M.TYPES.includes(type) || !id) return res.redirect('/admin/moderation');

    // User / private message: delete (sirf message) | keep (dismiss) | handled (user ke baare mein khud kar liya)
    if (type === 'message' && action === 'delete') {
      await pool.query('DELETE FROM messages WHERE id = $1', [id]);
      await M.resolve(type, id, 'resolved', 'delete', me);
      return done('Message deleted ✅');
    }
    if ((type === 'user' || type === 'message') && (action === 'keep' || action === 'handled')) {
      await M.resolve(type, id, action === 'keep' ? 'dismissed' : 'resolved', action, me);
      return done(action === 'keep' ? 'Dismissed. Reports closed ✅' : 'Marked as handled ✅');
    }
    if (type === 'user' || type === 'message') return res.redirect('/admin/moderation');

    if (action === 'delete' && type !== 'poll') {
      await pool.query(`DELETE FROM ${type === 'comment' ? 'comments' : 'poll_comments'} WHERE id = $1`, [id]);
      await M.resolve(type, id, 'resolved', 'delete', me);
      return done('Comment deleted ✅');
    }
    if (action === 'keep') {
      if (type !== 'poll') await pool.query(`UPDATE ${type === 'comment' ? 'comments' : 'poll_comments'} SET is_hidden = false WHERE id = $1`, [id]);
      await M.resolve(type, id, 'dismissed', 'keep', me);
      return done('Kept. Reports closed ✅');
    }
    if (action === 'close' && type === 'poll') {
      await pool.query('UPDATE polls SET is_closed = true WHERE id = $1', [id]);
      await M.resolve(type, id, 'resolved', 'close', me);
      return done('Contest closed ✅');
    }
    res.redirect('/admin/moderation');
  } catch (err) { next(err); }
});

router.post('/admin/moderation/words', requireAdmin, async (req, res, next) => {
  try {
    const words = await spam.saveWords(String(req.body.words || '').slice(0, 20000));
    res.redirect('/admin/moderation?msg=' + encodeURIComponent(`Spam words saved (${words.length}) ✅`));
  } catch (err) { next(err); }
});

module.exports = router;
