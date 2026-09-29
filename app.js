require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const pool = require('./db');
const authRouter = require('./routes/auth');
const postsRouter = require('./routes/posts');

const app = express();
const isProd = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('trust proxy', 1); // Render proxy ke peeche HTTPS cookies ke liye
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    store: new pgSession({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24,
    },
  })
);

app.use(async (req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.isAdmin = !!(req.session.user && req.session.user.role === 'admin');
  res.locals.metaDescription = 'Notes and tutorials on cricket, video editing, AI, freelancing and web development.';
  try {
    const r = await pool.query('SELECT DISTINCT category FROM posts ORDER BY category');
    res.locals.navCategories = r.rows.map((x) => x.category);
  } catch (err) {
    res.locals.navCategories = [];
  }
  next();
});

app.use('/', postsRouter);
app.use('/', authRouter);

app.listen(PORT, (err) => {
  if (err) {
    console.error('Server start nahi hua:', err.message);
    process.exit(1);
  }
  console.log('Server chal raha hai, port ' + PORT);
});