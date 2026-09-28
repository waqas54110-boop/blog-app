const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db');

const router = express.Router();

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
    success: req.query.signup === 'success' ? 'Account created! Please log in.' : null,
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

// ---------- LOGOUT ----------
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;