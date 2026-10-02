const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../db');
const config = require('../config');
const { sendMail, mailConfigured } = require('../lib/mailer');
const { esc } = require('../lib/notify');
const google = require('../lib/google');
const referral = require('../lib/referral');

const router = express.Router();

const RESET_TTL_MINUTES = 60;
const VERIFY_TTL_HOURS = 24;
const EMAIL_RE = /^\S+@\S+\.\S+$/;
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const isToken = (v) => /^[a-f0-9]{64}$/.test(String(v || ''));

const baseUrl = (req) => config.siteUrl || `${req.protocol}://${req.get('host')}`;
const googleRedirectUri = (req) => `${baseUrl(req)}/auth/google/callback`;

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Login ho jane par session banao aur (agar vote link se aaya tha to) wapas wahin bhejo
function startSession(req, res, user) {
  req.session.user = { id: user.id, username: user.username, role: user.role };
  const back = req.session.returnTo;
  delete req.session.returnTo;
  res.redirect(/^\/(votes\/\d{1,9}|posts\/[a-z0-9-]{1,120})$/.test(back || '') ? back : '/');
}

// Verification email (purane links saaf, naya 24 ghante ka). SMTP na ho to link console mein.
async function sendVerification(user, req) {
  await pool.query('DELETE FROM email_verifications WHERE user_id = $1 OR expires_at < now()', [user.id]);
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO email_verifications (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3::int * interval '1 hour'))`,
    [user.id, sha256(token), VERIFY_TTL_HOURS]
  );
  const link = `${baseUrl(req)}/verify-email/${token}`;

  if (!mailConfigured) {
    console.log(`[verify] SMTP set nahi hai. ${user.email} ke liye verification link (${VERIFY_TTL_HOURS} ghante):`, link);
    return;
  }
  // await nahi: signup/resend ka jawab email server ke intezar mein na ruke
  sendMail({
    to: user.email,
    subject: `Verify your email for ${config.siteName}`,
    text: `Hi ${user.username},\n\nApni email verify karne ke liye ye link kholein (${VERIFY_TTL_HOURS} ghante tak chalega):\n${link}\n\nAgar ye account aap ne nahi banaya to is email ko ignore kar dein.`,
    html: `<p>Hi ${esc(user.username)},</p>
           <p>Apni email verify karne ke liye neeche button dabayein. Link ${VERIFY_TTL_HOURS} ghante tak chalega.</p>
           <p><a href="${link}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Verify email</a></p>
           <p style="font-size:12px;color:#777">Agar ye account aap ne nahi banaya to is email ko ignore kar dein.</p>`,
  });
}

// Google profile se ek unique username (email ke @ se pehle wale hisse se)
async function uniqueUsername(base) {
  let clean = String(base || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30);
  if (clean.length < 3) clean = (clean + 'user').slice(0, 30);
  for (let i = 0; i < 6; i++) {
    const candidate = i === 0 ? clean : clean + Math.floor(1000 + Math.random() * 9000);
    const r = await pool.query('SELECT 1 FROM users WHERE lower(username) = $1', [candidate]);
    if (!r.rowCount) return candidate;
  }
  return clean + crypto.randomBytes(4).toString('hex');
}

// ---------- SIGNUP ----------
router.get('/signup', async (req, res) => {
  res.render('signup', { error: null, invitedBy: await referral.referrerName(req) });
});

router.post('/signup', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const { password, confirmPassword } = req.body;

  if (!username || !email || !password) {
    return res.render('signup', { error: 'All fields are required.' });
  }
  if (username.length > 50) {
    return res.render('signup', { error: 'Username 50 characters se chhota hona chahiye.' });
  }
  if (!EMAIL_RE.test(email) || email.length > 100) {
    return res.render('signup', { error: 'Please enter a valid email address.' });
  }
  if (password.length < 8) {
    return res.render('signup', { error: 'Password must be at least 8 characters long.' });
  }
  if (password !== confirmPassword) {
    return res.render('signup', { error: 'Passwords do not match.' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    // SMTP set nahi to verification email ja hi nahi sakti: tab account seedha verified (warna koi login na kar sake)
    const autoVerify = !mailConfigured;
    const r = await pool.query(
      `INSERT INTO users (username, email, password_hash, email_verified)
       VALUES ($1, $2, $3, $4) RETURNING id, username, email`,
      [username, email, passwordHash, autoVerify]
    );
    await referral.attach(r.rows[0], req, res); // invite link se aaya ho to bulane wale se jor do
    if (!autoVerify) {
      await sendVerification(r.rows[0], req);
      return res.redirect('/login?signup=verify');
    }
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
      : req.query.signup === 'verify' ? 'Account ban gaya! Aap ki email par verification link bheja gaya hai. Link kholne ke baad login karein.'
      : req.query.verified === '1' ? 'Email verify ho gayi. Ab login karein.'
      : req.query.reset === 'success' ? 'Password badal gaya. Ab naye password se login karein.'
      : null,
  });
});

router.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim();
  const { password } = req.body;

  if (!email || !password) {
    return res.render('login', { error: 'Please enter both email and password.', success: null });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE lower(email) = lower($1) ORDER BY id LIMIT 1', [email]);
    const user = result.rows[0];

    // Google se bane account ka password_hash NULL hota hai: password se login nahi, Google button ya "Forgot password"
    const match = user && user.password_hash && (await bcrypt.compare(password, user.password_hash));
    if (!match) {
      return res.render('login', { error: 'Invalid email or password.', success: null });
    }

    // Password sahi hai, magar email verify nahi hui
    if (!user.email_verified) {
      return res.render('login', {
        error: 'Pehle apni email verify karein. Aap ki email par bheje gaye link ko kholein.',
        success: null,
        unverifiedEmail: user.email,
      });
    }

    startSession(req, res, user);
  } catch (err) {
    console.error(err);
    res.status(500).render('login', { error: 'Server error, please try again.', success: null });
  }
});

// ---------- EMAIL VERIFICATION ----------
router.get('/verify-email/:token', async (req, res) => {
  const bad = () =>
    res.status(400).render('login', {
      error: 'Ye verification link ghalat ya purana hai. Login karke naya link mangwa lein.',
      success: null,
    });
  try {
    if (!isToken(req.params.token)) return bad();
    const r = await pool.query(
      'SELECT user_id FROM email_verifications WHERE token_hash = $1 AND expires_at > now()',
      [sha256(req.params.token)]
    );
    if (!r.rows[0]) return bad();

    await pool.query('UPDATE users SET email_verified = true WHERE id = $1', [r.rows[0].user_id]);
    await pool.query('DELETE FROM email_verifications WHERE user_id = $1', [r.rows[0].user_id]);
    res.redirect('/login?verified=1');
  } catch (err) {
    console.error('[verify] ', err.message);
    res.status(500).send('Server error');
  }
});

router.post('/resend-verification', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  try {
    if (EMAIL_RE.test(email)) {
      const r = await pool.query(
        'SELECT id, username, email FROM users WHERE lower(email) = $1 AND email_verified = false ORDER BY id LIMIT 1',
        [email]
      );
      if (r.rows[0]) await sendVerification(r.rows[0], req);
    }
  } catch (err) {
    console.error('[verify] resend:', err.message);
  }
  // Hamesha ek jaisa jawab: account maujood hai ya nahi, ye pata na chale
  res.render('login', {
    error: null,
    success: 'Agar ye email registered hai aur verify nahi hui, to naya verification link bhej diya gaya hai.',
  });
});

// ---------- GOOGLE LOGIN ----------
router.get('/auth/google', (req, res) => {
  if (!google.enabled) return res.redirect('/login');
  const state = crypto.randomBytes(24).toString('hex');
  req.session.googleState = state;
  res.redirect(google.authUrl({ state, redirectUri: googleRedirectUri(req) }));
});

router.get('/auth/google/callback', async (req, res) => {
  if (!google.enabled) return res.redirect('/login');
  const fail = (msg) => res.status(400).render('login', { error: msg, success: null });

  const expected = req.session.googleState;
  delete req.session.googleState; // state sirf ek baar chalta hai

  if (req.query.error) return fail('Google login cancel ho gaya.');
  if (!expected || !req.query.code || !safeEqual(req.query.state || '', expected)) {
    return fail('Google login ka session expire ho gaya. Dobara koshish karein.');
  }

  try {
    const p = await google.fetchProfile(String(req.query.code), googleRedirectUri(req));
    if (!p.sub || !p.email || !p.emailVerified) {
      return fail('Aap ki Google email verified nahi hai, is liye login nahi ho saka.');
    }

    let user = (await pool.query('SELECT * FROM users WHERE google_id = $1', [p.sub])).rows[0];

    if (!user) {
      const existing = (
        await pool.query('SELECT * FROM users WHERE lower(email) = $1 ORDER BY id LIMIT 1', [p.email])
      ).rows[0];

      if (existing) {
        if (existing.google_id && existing.google_id !== p.sub) {
          return fail('Ye email kisi aur Google account se juri hui hai.');
        }
        // Pehle se account hai: Google se jor do. Agar wo email verify nahi thi (kisi ne doosre ki email se
        // signup kiya ho sakta hai), to us ka purana password hata do, taake asli malik hi is account ka malik rahe.
        user = (
          await pool.query(
            `UPDATE users
                SET google_id = $1,
                    password_hash = CASE WHEN email_verified THEN password_hash ELSE NULL END,
                    email_verified = true
              WHERE id = $2 RETURNING *`,
            [p.sub, existing.id]
          )
        ).rows[0];
      } else {
        const username = await uniqueUsername(p.email.split('@')[0]);
        user = (
          await pool.query(
            `INSERT INTO users (username, email, password_hash, email_verified, google_id)
             VALUES ($1, $2, NULL, true, $3) RETURNING *`,
            [username, p.email, p.sub]
          )
        ).rows[0];
        await referral.attach(user, req, res); // naya Google account: invite link se aaya ho to jor do
      }
    }

    startSession(req, res, user);
  } catch (err) {
    console.error('[google] ', err.message);
    if (err.code === '23505') return fail('Account banate waqt masla aaya, dobara koshish karein.');
    fail('Google login nahi ho saka. Thori der baad dobara koshish karein.');
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
    await pool.query('UPDATE users SET password_hash = $1, email_verified = true WHERE id = $2', [hash, row.user_id]);
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