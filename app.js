require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const rateLimit = require('express-rate-limit');
const pool = require('./db');
const config = require('./config');
const csrf = require('./lib/csrf');
const google = require('./lib/google');
const { startNewsletterScheduler } = require('./lib/newsletter');
const { startPublisher } = require('./lib/publisher');
const card = require('./lib/card');
const { siteLd, safeJson } = require('./lib/seo');
const authRouter = require('./routes/auth');
const postsRouter = require('./routes/posts');
const engageRouter = require('./routes/engage');
const uploadsRouter = require('./routes/uploads');
const growthRouter = require('./routes/growth');
const hireRouter = require('./routes/hire');
const votesRouter = require('./routes/votes');
const sponsorRouter = require('./routes/sponsor');
const profileRouter = require('./routes/profile');
const friendsRouter = require('./routes/friends');
const friendsLib = require('./lib/friends');
const moderationRouter = require('./routes/moderation');
const moderationLib = require('./lib/moderation');
const { startFollowNotifier } = require('./lib/follow');
const { startTelegramPoster } = require('./lib/telegram');
const { startPollScheduler } = require('./lib/polls');

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

// Uploaded images/videos (/img/..., /video/...) is global limit mein count nahi hoti:
// ek page par kai images hoti hain aur video har seek par chhoti requests bhejti hai
app.use(limiter(15, 400, 'Too many requests. Please wait a few minutes and try again.', {
  // /votes/:id/state.json (live counting) ka apna alag limit neeche hai
  skip: (req) => req.path.startsWith('/img/') || req.path.startsWith('/video/') || /^\/votes\/\d+\/state\.json$/.test(req.path),
}));
app.post(['/login', '/signup'], limiter(15, 15, 'Too many login/signup attempts. Please try again in 15 minutes.'));
app.post('/subscribe', limiter(60, 6, 'Too many subscribe attempts. Please try again later.'));
app.post('/posts/:id/comments', limiter(5, 10, 'You are commenting too fast. Please wait a few minutes.'));
app.post('/resend-verification', limiter(60, 5, 'Too many requests. Please try again in an hour.'));
app.get('/verify-email/:token', limiter(15, 20, 'Too many attempts. Please try again in a few minutes.'));
app.get(['/auth/google', '/auth/google/callback'], limiter(15, 30, 'Too many login attempts. Please try again in a few minutes.'));
app.post('/forgot-password', limiter(60, 5, 'Too many reset requests. Please try again in an hour.'));
app.post('/reset-password/:token', limiter(15, 10, 'Too many attempts. Please try again in a few minutes.'));
app.post('/upload-image', limiter(10, 40, 'Too many uploads. Please wait a few minutes.'));
app.post('/upload-video', limiter(30, 10, 'Too many video uploads. Please wait a while.'));
// Galat form (400) count nahi hota, taake insaan ki typing ghalti par block na ho
app.post('/hire', limiter(60, 5, 'Too many messages sent. Please try again in an hour.', { skipFailedRequests: true }));
app.post('/votes/:id/vote', limiter(10, 60, 'Too many votes. Please wait a few minutes.'));
app.get('/votes/:id/state.json', limiter(1, 40, 'Too many requests.'));
app.post('/votes/:id/share', limiter(10, 60, 'Too many requests.'));
app.get('/votes/:id/go', limiter(1, 30, 'Too many requests.'));
app.post('/votes/:id/comments', limiter(5, 10, 'You are commenting too fast. Please wait a few minutes.'));
app.post('/push/subscribe', limiter(15, 20, 'Too many attempts. Please try again later.'));
app.post('/report', limiter(10, 10, 'You are reporting too fast. Please wait a few minutes.'));
app.post(['/u/:username/follow', '/u/:username/unfollow', '/u/:username/follow-email'], limiter(10, 30, 'Too many requests. Please wait a few minutes.'));
app.post('/friends/:action/:username', limiter(10, 40, 'Too many requests. Please wait a few minutes.'));
app.get('/r/:code', limiter(10, 30, 'Too many requests. Please try again in a few minutes.'));

// Image upload: body seedhi image bytes hoti hai (CSRF token header x-csrf-token mein aata hai).
// Ye csrf middleware se pehle hona chahiye.
app.post(
  '/upload-image',
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], limit: '6mb' })
);

// Video upload: body seedhi video bytes (CSRF token header x-csrf-token mein). Ye bhi csrf se pehle.
app.post(
  '/upload-video',
  express.raw({ type: ['video/mp4', 'video/webm'], limit: config.videoMaxMb + 'mb' })
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
  // Report ke baad / spam filter ke "review mein hai" wale chhote messages (post aur contest page dikhate hain)
  res.locals.reportedFlash = req.query.reported === '1';
  res.locals.commentNotice = req.query.commentNotice ? String(req.query.commentNotice).slice(0, 200) : null;

  // Community links (post ke neeche banner + footer)
  res.locals.whatsappUrl = config.whatsappUrl;
  res.locals.facebookUrl = config.facebookUrl;
  res.locals.whatsappChannelUrl = config.whatsappChannelUrl;
  res.locals.siteName = config.siteName;
  res.locals.googleEnabled = google.enabled;
  res.locals.videoMaxMb = config.videoMaxMb;

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

  // Friend requests jo accept ka intezar kar rahi hain (header badge). Alag try: migration_v14 na chali ho to site na ruke
  res.locals.pendingFriends = 0;
  if (req.session.user) {
    try {
      res.locals.pendingFriends = await friendsLib.pendingCount(req.session.user.id);
    } catch (err) {
      console.error('friend requests count (migration_v14.sql chali?):', err.message);
    }
  }

  // Admin ke liye: moderation queue mein kitni cheezein review ka intezar kar rahi hain (alag try: migration_v13 na chali ho to site na ruke)
  res.locals.openReports = 0;
  if (res.locals.isAdmin) {
    try {
      res.locals.openReports = await moderationLib.openCount();
    } catch (err) {
      console.error('open reports count:', err.message);
    }
  }

  // Owner ke liye: kitni nayi "Hire Me" inquiries abhi parhi nahi (alag try: migration_v6 na chali ho to baaqi site na ruke)
  res.locals.newInquiries = 0;
  if (res.locals.isAdmin) {
    try {
      const q = await pool.query("SELECT COUNT(*)::int AS c FROM inquiries WHERE status = 'new'");
      res.locals.newInquiries = q.rows[0].c;
    } catch (err) {
      console.error('inquiries count:', err.message);
    }
  }
  next();
});

// ---------- CSRF (har POST form mein hidden _csrf) ----------
app.use(csrf);

app.use('/', postsRouter);
app.use('/', engageRouter);
app.use('/', uploadsRouter);
app.use('/', growthRouter);
app.use('/', hireRouter);
app.use('/', sponsorRouter);
app.use('/', votesRouter);
app.use('/', profileRouter);
app.use('/', friendsRouter);
app.use('/', moderationRouter);
app.use('/', authRouter);

app.use((req, res) => {
  res.status(404).render('404', { title: 'Not Found' });
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    const isVideo = req.path === '/upload-video';
    return res.status(413).json({
      error: isVideo ? `Video is too large (max ${config.videoMaxMb} MB).` : 'Image is too large (max 5 MB).',
    });
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
  startPollScheduler(); // knockout rounds jin ka time ho gaya unhein agle round par le jata hai
  startTelegramPoster(); // naya contest / result Telegram channel mein (token set ho to)
  startFollowNotifier(); // followers ko naya post / contest ki notification (+ email)
});
