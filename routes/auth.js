const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../db');
const config = require('../config');
const { sendMail, mailConfigured } = require('../lib/mailer');
const { esc } = require('../lib/notify');

const router = express.Router();

const RESET_TTL_MINUTES = 60;
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const isToken = (v) => /^[a-f0-9]{64}$/.test(String(v || ''));

// ---------- SIGNUP ----------
router.get('/signup', (req, res) => {
  res.render('signup', { error: null });
});

router.post('/signup', async (req, res) => {
  const { username, email, password, confirmPassword } = req.body;

  if (!username || !email || !password) {
    return res.render('signup', { error: 'All fields are required.' });
  }
  if (password.length < 8) {
    return res.render('signup', { error: 'Password must be at least 8 characters long.' });
  }
  if (password !== confirmPassword) {
    return res.render('signup', { error: 'Passwords do not match.' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3)',
      [username, email, passwordHash]
    );
    res.redirect('/login?signup=success');
  } catch (err) {
    if (err.code === '23505') {
      return res.render('signup', { error: 'Username or email already exists.' });
    }
    console.error(err);
    res.status(500).render('signup', { error: 'Server error, please try again.' });
  }
});

// ---------- LOGIN ----------
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', {
    error: null,
    success:
      req.query.signup === 'success' ? 'Account created! Please log in.'
      : req.query.reset === 'success' ? 'Password badal gaya. Ab naye password se login karein.'
      : null,
  });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('login', { error: 'Please enter both email and password.', success: null });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    const match = user && (await bcrypt.compare(password, user.password_hash));
    if (!match) {
      return res.render('login', { error: 'Invalid email or password.', success: null });
    }

req.session.user = { id: user.id, username: user.username, role: user.role };  
  res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(500).render('login', { error: 'Server error, please try again.', success: null });
  }
});

// ---------- FORGOT PASSWORD ----------
router.get('/forgot-password', (req, res) => {
  res.render('forgot', { title: 'Forgot password', error: null, sent: false });
});

router.post('/forgot-password', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return res.render('forgot', { title: 'Forgot password', error: 'Please enter a valid email address.', sent: false });
  }

  try {
    const r = await pool.query(
      'SELECT id, username, email FROM users WHERE lower(email) = $1 ORDER BY id LIMIT 1',
      [email]
    );
    const user = r.rows[0];

    if (user) {
      // Purane tokens saaf, phir naya (DB mein sirf hash jata hai)
      await pool.query('DELETE FROM password_resets WHERE user_id = $1 OR expires_at < now()', [user.id]);
      const token = crypto.randomBytes(32).toString('hex');
      await pool.query(
        `INSERT INTO password_resets (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + ($3::int * interval '1 minute'))`,
        [user.id, sha256(token), RESET_TTL_MINUTES]
      );

      // SITE_URL set ho to wahi use hota hai (Host header par bharosa nahi)
      const base = config.siteUrl || `${req.protocol}://${req.get('host')}`;
      const link = `${base}/reset-password/${token}`;

      if (!mailConfigured) {
        console.log(`[reset] SMTP set nahi hai. ${user.email} ke liye reset link (${RESET_TTL_MINUTES} min):`, link);
      } else {
        // await nahi: jawab ka waqt is baat se na badle ke email maujood thi ya nahi
        sendMail({
          to: user.email,
          subject: `Reset your ${config.siteName} password`,
          text: `Hi ${user.username},\n\nPassword reset karne ke liye ye link kholein (${RESET_TTL_MINUTES} minute tak chalega):\n${link}\n\nAgar ye aap ne nahi mangwaya to is email ko ignore kar dein.`,
          html: `<p>Hi ${esc(user.username)},</p>
                 <p>Password reset karne ke liye neeche button dabayein. Link ${RESET_TTL_MINUTES} minute tak chalega.</p>
                 <p><a href="${link}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Reset password</a></p>
                 <p style="font-size:12px;color:#777">Agar ye aap ne nahi mangwaya to is email ko ignore kar dein.</p>`,
        });
      }
    }
  } catch (err) {
    console.error('[reset] forgot:', err.message);
  }

  // Hamesha ek jaisa jawab: account maujood hai ya nahi, ye pata na chale
  res.render('forgot', { title: 'Forgot password', error: null, sent: true });
});

// ---------- RESET PASSWORD ----------
async function findValidReset(token) {
  if (!isToken(token)) return null;
  const r = await pool.query(
    'SELECT id, user_id FROM password_resets WHERE token_hash = $1 AND expires_at > now()',
    [sha256(token)]
  );
  return r.rows[0] || null;
}

router.get('/reset-password/:token', async (req, res) => {
  try {
    const row = await findValidReset(req.params.token);
    res.render('reset', { title: 'Reset password', invalid: !row, error: null, token: req.params.token });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

router.post('/reset-password/:token', async (req, res) => {
  const token = req.params.token;
  const { password, confirmPassword } = req.body;
  const show = (error, invalid = false) =>
    res.render('reset', { title: 'Reset password', invalid, error, token });

  try {
    const row = await findValidReset(token);
    if (!row) return show(null, true);

    if (!password || password.length < 8) return show('Password must be at least 8 characters long.');
    if (password !== confirmPassword) return show('Passwords do not match.');

    const hash = await bcrypt.hash(password, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, row.user_id]);
    await pool.query('DELETE FROM password_resets WHERE user_id = $1', [row.user_id]);

    // Is user ki purani login sessions band (agar koi aur chala raha tha to wo bhi logout)
    try {
      await pool.query(`DELETE FROM "session" WHERE (sess -> 'user' ->> 'id') = $1`, [String(row.user_id)]);
    } catch (e) {
      console.error('[reset] session cleanup:', e.message);
    }

    res.redirect('/login?reset=success');
  } catch (err) {
    console.error(err);
    show('Server error, please try again.');
  }
});

// ---------- LOGOUT ----------
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;