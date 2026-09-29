require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const rateLimit = require('express-rate-limit');
const pool = require('./db');
const config = require('./config');
const csrf = require('./lib/csrf');
const { startNewsletterScheduler } = require('./lib/newsletter');
const { startPublisher } = require('./lib/publisher');
const card = require('./lib/card');
const { siteLd, safeJson } = require('./lib/seo');
const authRouter = require('./routes/auth');
const postsRouter = require('./routes/posts');
const engageRouter = require('./routes/engage');
const uploadsRouter = require('./routes/uploads');
const growthRouter = require('./routes/growth');

const app = express();
const isProd = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('trust proxy', 1); // Render proxy ke peeche HTTPS cookies ke liye
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: true }));

// ---------- Rate limiting ----------
const limiter = (windowMinutes, limit, message, opts = {}) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => res.status(429).type('text').send(message),
    ...opts,
  });

// Uploaded images (/img/...) is global limit mein count nahi hoti: ek page par kai images hoti hain
app.use(limiter(15, 400, 'Too many requests. Please wait a few minutes and try again.', {
  skip: (req) => req.path.startsWith('/img/'),
}));
app.post(['/login', '/signup'], limiter(15, 15, 'Too many login/signup attempts. Please try again in 15 minutes.'));
app.post('/subscribe', limiter(60, 6, 'Too many subscribe attempts. Please try again later.'));
app.post('/posts/:id/comments', limiter(5, 10, 'You are commenting too fast. Please wait a few minutes.'));
app.post('/forgot-password', limiter(60, 5, 'Too many reset requests. Please try again in an hour.'));
app.post('/reset-password/:token', limiter(15, 10, 'Too many attempts. Please try again in a few minutes.'));
app.post('/upload-image', limiter(10, 40, 'Too many uploads. Please wait a few minutes.'));
app.post('/push/subscribe', limiter(15, 20, 'Too many attempts. Please try again later.'));

// Image upload: body seedhi image bytes hoti hai (CSRF token header x-csrf-token mein aata hai).
// Ye csrf middleware se pehle hona chahiye.
app.post(
  '/upload-image',
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], limit: '6mb' })
);

// Push subscribe/unsubscribe JSON bhejte hain (CSRF token header x-csrf-token mein)
app.use('/push', express.json({ limit: '8kb' }));

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
  // Default share image: .env ki DEFAULT_OG_IMAGE, warna khud bana hua site card
  res.locals.ogImage = config.defaultOgImage || (card.isAvailable() ? base + '/og/site.png' : null);
  res.locals.ogImageCard = !config.defaultOgImage && card.isAvailable();
  res.locals.ogType = 'website';
  res.locals.safeJson = safeJson;
  res.locals.jsonLd = req.path === '/'
    ? siteLd({ base, siteName: config.siteName, description: res.locals.metaDescription })
    : [];

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
app.use('/', uploadsRouter);
app.use('/', growthRouter);
app.use('/', authRouter);

app.use((req, res) => {
  res.status(404).render('404', { title: 'Not Found' });
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Image is too large (max 5 MB).' });
  }
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
  startPublisher();
});
