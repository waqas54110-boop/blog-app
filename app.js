require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const rateLimit = require('express-rate-limit');
const pool = require('./db');
const config = require('./config');
const csrf = require('./lib/csrf');
const { startNewsletterScheduler } = require('./lib/newsletter');
const authRouter = require('./routes/auth');
const postsRouter = require('./routes/posts');
const engageRouter = require('./routes/engage');

const app = express();
const isProd = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('trust proxy', 1); // Render proxy ke peeche HTTPS cookies ke liye
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: true }));

// ---------- Rate limiting ----------
const limiter = (windowMinutes, limit, message) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => res.status(429).type('text').send(message),
  });

app.use(limiter(15, 400, 'Too many requests. Please wait a few minutes and try again.'));
app.post(['/login', '/signup'], limiter(15, 15, 'Too many login/signup attempts. Please try again in 15 minutes.'));
app.post('/subscribe', limiter(60, 6, 'Too many subscribe attempts. Please try again later.'));
app.post('/posts/:id/comments', limiter(5, 10, 'You are commenting too fast. Please wait a few minutes.'));

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
  res.locals.subscribed = req.query.subscribed === '1';
  res.locals.subscribeError = req.query.subscribeError || null;

  // Community links (post ke neeche banner + footer)
  res.locals.whatsappUrl = config.whatsappUrl;
  res.locals.facebookUrl = config.facebookUrl;
  res.locals.whatsappChannelUrl = config.whatsappChannelUrl;
  res.locals.siteName = config.siteName;

  // Open Graph defaults (post page inhein override karta hai)
  const base = config.siteUrl || `${req.protocol}://${req.get('host')}`;
  res.locals.ogUrl = base + req.path;
  res.locals.ogImage = config.defaultOgImage || null;
  res.locals.ogType = 'website';

  res.locals.unreadCount = 0;
  res.locals.navCategories = [];
  try {
    const r = await pool.query(
      'SELECT DISTINCT category FROM posts p WHERE p.is_draft = false AND p.publish_at <= now() ORDER BY category'
    );
    res.locals.navCategories = r.rows.map((x) => x.category);
    if (req.session.user) {
      const n = await pool.query(
        'SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND is_read = false',
        [req.session.user.id]
      );
      res.locals.unreadCount = n.rows[0].c;
    }
  } catch (err) {
    console.error('locals middleware:', err.message);
  }
  next();
});

// ---------- CSRF (har POST form mein hidden _csrf) ----------
app.use(csrf);

app.use('/', postsRouter);
app.use('/', engageRouter);
app.use('/', authRouter);

app.use((req, res) => {
  res.status(404).render('404', { title: 'Not Found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).send('Server error');
});

app.listen(PORT, (err) => {
  if (err) {
    console.error('Server start nahi hua:', err.message);
    process.exit(1);
  }
  console.log('Server chal raha hai, port ' + PORT);
  startNewsletterScheduler();
});
