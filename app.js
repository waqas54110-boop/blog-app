require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const rateLimit = require('express-rate-limit');
const pool = require('./db');
const config = require('./config');
const { COUNTRY_LIST } = require('./lib/demographics');
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
const courtRouter = require('./routes/court');
const petitionsRouter = require('./routes/petitions');
const creatorsRouter = require('./routes/creators');
const trendsRouter = require('./routes/trends');
const cricketRouter = require('./routes/cricket');
const headlinesRouter = require('./routes/headlines');
const headlinesLib = require('./lib/headlines');
const sponsorRouter = require('./routes/sponsor');
const profileRouter = require('./routes/profile');
const friendsRouter = require('./routes/friends');
const friendsLib = require('./lib/friends');
const messagesRouter = require('./routes/messages');
const callsRouter = require('./routes/calls');
const liveRouter = require('./routes/live');
const messagesLib = require('./lib/messages');
const avatarRouter = require('./routes/avatar');
const moderationRouter = require('./routes/moderation');
const moderationLib = require('./lib/moderation');
const feedRouter = require('./routes/feed');
const homeRouter = require('./routes/home');
const storiesRouter = require('./routes/stories');
const groupsRouter = require('./routes/groups');
const earningsRouter = require('./routes/earnings');
const earningsLib = require('./lib/earnings');
const adsRouter = require('./routes/ads');
const adsLib = require('./lib/ads');
const { startCleaner: startStoryCleaner } = require('./lib/stories');
const { startFollowNotifier } = require('./lib/follow');
const { startTelegramPoster } = require('./lib/telegram');
const { startPollScheduler } = require('./lib/polls');
const { startCourtScheduler } = require('./lib/court');

const app = express();
const isProd = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('trust proxy', 1); // Render proxy ke peeche HTTPS cookies ke liye
app.disable('x-powered-by');

// ---------- SEO / speed (V24) ----------
// 1) Gzip: pages chhote hote hain, load tez (Google speed ko ranking mein ginta hai). `npm install` se package aata hai;
//    na ho to site phir bhi chalti hai.
try {
  const compression = require('compression');
  app.use(compression());
} catch (e) {
  console.warn('[seo] compression package nahi mila: `npm install` chalayen (site bina gzip ke chal rahi hai)');
}

// 2) Asli domain: FORCE_CANONICAL_HOST=1 ho to www / railway.app / http wale visitors 301 se SITE_URL par jate hain
//    (warna Google ek hi site ke kai URL alag alag ginta hai)
if (config.forceCanonicalHost && config.siteUrl) {
  let canonHost = null;
  try { canonHost = new URL(config.siteUrl).host; } catch (e) { /* SITE_URL galat */ }
  if (canonHost) {
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const wrongHost = req.get('host') !== canonHost;
      const wrongProto = isProd && config.siteUrl.startsWith('https://') && req.protocol !== 'https';
      if (!wrongHost && !wrongProto) return next();
      res.redirect(301, config.siteUrl + req.originalUrl);
    });
  }
}

// 3) /blog/ aur /blog ek hi page hain: trailing slash hata kar 301 (duplicate URL nahi banta)
app.use((req, res, next) => {
  if ((req.method === 'GET' || req.method === 'HEAD') && req.path.length > 1 && req.path.endsWith('/')) {
    const q = req.originalUrl.indexOf('?');
    return res.redirect(301, req.path.replace(/\/+$/, '') + (q === -1 ? '' : req.originalUrl.slice(q)));
  }
  next();
});

// 4) Halka security + trust headers
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (isProd) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});

// 5) Koi bhi error page (404, 403, 500...) automatically noindex: Google error pages ko index nahi karta
app.use((req, res, next) => {
  const orig = res.status.bind(res);
  res.status = (code) => {
    if (code >= 400 && !res.locals.robots) res.locals.robots = 'noindex,nofollow';
    return orig(code);
  };
  next();
});

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
  skip: (req) => req.path.startsWith('/img/') || req.path.startsWith('/video/') || req.path.startsWith('/a/') || /^\/messages\/[^/]+\/poll$/.test(req.path) || /^\/messages\/media\/\d+$/.test(req.path) || /^\/groups\/[^/]+\/chat\/poll$/.test(req.path) || /^\/votes\/\d+\/state\.json$/.test(req.path) || req.path.startsWith('/calls/') || req.path.startsWith('/live/') || req.path.startsWith('/cricket/bar/') || /^\/cricket\/m\/\d+\/state\.json$/.test(req.path)
    || req.path.startsWith('/stories/') || req.path.startsWith('/icons/') || req.path === '/sw.js' || req.path === '/manifest.webmanifest' || req.path === '/offline',
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
app.post('/earnings/withdraw', limiter(60, 10, 'Too many withdrawal attempts. Please try again later.'));
app.post('/earn/read', limiter(1, 30, 'Too many requests.'));
app.post('/upload-video', limiter(30, 10, 'Too many video uploads. Please wait a while.'));
// Calls: shuru karne par sakht limit; baaqi (poll / signal) ke liye kharab-khorak se bachne wala bara limit
app.post('/calls/start', limiter(10, 20, 'You are calling too often. Please wait a few minutes.'));
app.use('/calls', limiter(1, 600, 'Too many call requests. Please wait a minute.'));
// Live: shuru karne par sakht limit; baaqi (poll / signal) ke liye bara limit (ek host ke saath kai viewers ek hi WiFi par ho sakte hain)
app.post('/live/start', limiter(60, 10, 'You are going live too often. Please wait a while.'));
app.use('/live', limiter(1, 900, 'Too many live requests. Please wait a minute.'));
// Galat form (400) count nahi hota, taake insaan ki typing ghalti par block na ho
app.post('/hire', limiter(60, 5, 'Too many messages sent. Please try again in an hour.', { skipFailedRequests: true }));
app.post('/votes/:id/vote', limiter(10, 60, 'Too many votes. Please wait a few minutes.'));
app.get('/votes/:id/state.json', limiter(1, 40, 'Too many requests.'));
app.post('/votes/:id/share', limiter(10, 60, 'Too many requests.'));
app.get('/votes/:id/go', limiter(1, 30, 'Too many requests.'));
app.post('/votes/:id/comments', limiter(5, 10, 'You are commenting too fast. Please wait a few minutes.'));
app.post('/push/subscribe', limiter(15, 20, 'Too many attempts. Please try again later.'));
// V35: Street Cricket Manager. The score bar / scorecard poll every 4 seconds, so these limits are higher
app.get('/cricket/bar/:streamId', limiter(1, 60, 'Too many requests.'));
app.get('/cricket/m/:id/state.json', limiter(1, 60, 'Too many requests.'));
app.post('/cricket/m/:id/ball', limiter(1, 90, 'You are scoring too fast. Please wait a moment.'));
app.post('/cricket/players/:id/photo', limiter(10, 30, 'Too many photo uploads. Please wait a few minutes.'));
app.post('/cricket', limiter(60, 10, 'You are creating tournaments too fast. Please try again later.', { skipFailedRequests: true }));
app.post(['/cricket/t/:id/teams', '/cricket/t/:id/fixtures', '/cricket/t/:id/fixtures/auto', '/cricket/t/:id/teams/:tid/players'], limiter(10, 60, 'Too many requests. Please wait a few minutes.'));
// V34: People's Court + petitions
app.post('/court/:id/argue', limiter(60, 10, 'Too many attempts. Please try again later.', { skipFailedRequests: true }));
app.post('/court/:id/vote', limiter(10, 60, 'Too many votes. Please wait a few minutes.'));
app.post('/court/:id/closing', limiter(30, 10, 'Too many requests. Please wait a while.'));
app.post('/court/:id/share', limiter(10, 60, 'Too many requests.'));
app.post('/petitions', limiter(60, 8, 'You are starting petitions too fast. Please try again later.', { skipFailedRequests: true }));
app.post(['/petitions/:id/sign', '/petitions/:id/unsign'], limiter(10, 60, 'Too many requests. Please wait a few minutes.'));
app.post(['/petitions/:id/update', '/petitions/:id/resolve', '/petitions/:id/close'], limiter(30, 20, 'Too many requests. Please wait a while.'));
app.post('/petitions/:id/share', limiter(10, 60, 'Too many requests.'));
// V38: Creator Showcase + Trend Radar
app.post('/creators', limiter(60, 6, 'You are sharing links too fast. Please try again later.', { skipFailedRequests: true }));
app.post('/creators/:id/like', limiter(10, 80, 'Too many likes. Please wait a few minutes.'));
app.post('/creators/:id/comments', limiter(5, 12, 'You are commenting too fast. Please wait a few minutes.'));
app.post('/creators/:id/vote', limiter(10, 20, 'Too many requests. Please wait a few minutes.'));
app.get('/creators/:id/go', limiter(5, 60, 'Too many requests. Please try again in a few minutes.'));
app.post(['/creators/:id/delete', '/creators/comments/:cid/delete'], limiter(10, 30, 'Too many requests. Please wait a few minutes.'));
app.get('/trends', limiter(10, 30, 'Too many report requests. Please try again in a few minutes.'));
app.post('/trends/ai', limiter(60, 6, 'You can create up to 6 AI write-ups per hour. Please try again later.'));
app.post('/report', limiter(10, 10, 'You are reporting too fast. Please wait a few minutes.'));
app.post(['/u/:username/follow', '/u/:username/unfollow', '/u/:username/follow-email'], limiter(10, 30, 'Too many requests. Please wait a few minutes.'));
app.post('/friends/:action/:username', limiter(10, 40, 'Too many requests. Please wait a few minutes.'));
app.post('/messages/:username', limiter(1, 12, 'You are sending messages too fast. Please wait a minute.'));
app.get('/messages/:username/poll', limiter(1, 60, 'Too many requests.'));
app.post('/messages/:username/media', limiter(1, 10, 'You are sending photos / voice messages too fast. Please wait a minute.'));
app.get('/groups/:slug/chat/poll', limiter(1, 60, 'Too many requests.'));
app.post('/groups/:slug/chat', limiter(1, 20, 'You are sending messages too fast. Please wait a minute.'));
app.post('/groups/:slug/chat/:id/delete', limiter(5, 40, 'Too many requests. Please wait a few minutes.'));
app.post(['/groups/:slug/request', '/groups/:slug/request/cancel'], limiter(10, 20, 'Too many requests. Please wait a few minutes.'));
app.post(['/groups/:slug/requests/:userId/:action', '/groups/:slug/members/add', '/groups/:slug/members/:userId/remove', '/groups/:slug/privacy'], limiter(10, 60, 'Too many requests. Please wait a few minutes.'));
app.post('/upload-avatar', limiter(10, 10, 'Too many photo uploads. Please wait a few minutes.'));
app.post('/avatar/remove', limiter(10, 10, 'Too many requests. Please wait a few minutes.'));
app.post('/upload-feed-image', limiter(30, 20, 'Too many photo uploads. Please wait a while.'));
app.post('/feed', limiter(10, 8, 'You are posting too fast. Please wait a few minutes.'));
app.post('/feed/:id/comments', limiter(5, 12, 'You are commenting too fast. Please wait a few minutes.'));
app.post('/feed/views', limiter(10, 300, 'Too many requests. Please try again in a few minutes.'));
app.post('/feed/:id/like', limiter(10, 80, 'Too many likes. Please wait a few minutes.'));
app.post('/stories', limiter(30, 15, 'You are posting stories too fast. Please wait a while.'));
app.post('/stories/:id/seen', limiter(10, 400, 'Too many requests. Please try again in a few minutes.'));
app.post('/stories/:id/delete', limiter(10, 30, 'Too many requests. Please wait a few minutes.'));
app.get('/stories/tray.json', limiter(5, 60, 'Too many requests. Please try again in a few minutes.'));
app.get('/stories/:id/viewers', limiter(5, 60, 'Too many requests. Please try again in a few minutes.'));
app.post('/groups', limiter(60, 5, 'You are creating groups too fast. Please try again later.'));
app.post(['/groups/:slug/join', '/groups/:slug/leave'], limiter(10, 40, 'Too many requests. Please wait a few minutes.'));
app.post('/groups/:slug/delete', limiter(10, 10, 'Too many requests. Please wait a few minutes.'));
app.post(['/groups/join/:token', '/groups/:slug/invite/reset'], limiter(10, 20, 'Too many requests. Please wait a few minutes.'));
app.get('/r/:code', limiter(10, 30, 'Too many requests. Please try again in a few minutes.'));
// V39: Advertise on Khabzo
app.post('/advertise', limiter(60, 10, 'You are submitting ads too fast. Please try again later.', { skipFailedRequests: true }));
app.post('/advertise/topup', limiter(60, 10, 'Too many top-up requests. Please try again later.'));
app.post('/advertise/:id/:action', limiter(10, 40, 'Too many requests. Please wait a few minutes.'));
app.get('/ads/:id/go', limiter(5, 60, 'Too many requests. Please try again in a few minutes.'));

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

// Profile photo: browser 256x256 JPEG bana kar seedha bytes bhejta hai (CSRF token header x-csrf-token mein). Ye bhi csrf se pehle.
app.post('/upload-avatar', express.raw({ type: ['image/jpeg'], limit: '1mb' }));

// Feed photo: browser 1600px JPEG bana kar seedha bytes bhejta hai (CSRF token header mein). Ye bhi csrf se pehle.
app.post('/upload-feed-image', express.raw({ type: ['image/jpeg'], limit: '2mb' }));

// Private message photo / voice: browser seedhi file bytes bhejta hai (CSRF token header x-csrf-token mein). Ye bhi csrf se pehle.
app.post(
  '/messages/:username/media',
  express.raw({ type: ['image/jpeg', 'audio/webm', 'audio/ogg', 'audio/mp4'], limit: '3mb' })
);

// Push subscribe/unsubscribe JSON bhejte hain (CSRF token header x-csrf-token mein)
app.use('/push', express.json({ limit: '8kb' }));

// Calls: signaling JSON (CSRF token header x-csrf-token ya body ke _csrf mein; sendBeacon body mein bhejta hai). Ye bhi csrf se pehle.
app.use('/calls', express.json({ limit: '64kb' }));

// Cricket player photo: the browser sends a 256x256 JPEG as raw bytes (CSRF token in the x-csrf-token header). Must come before CSRF.
app.post('/cricket/players/:id/photo', express.raw({ type: ['image/jpeg'], limit: '1mb' }));

// Cricket scorer: JSON (CSRF token in the x-csrf-token header). Must come before CSRF.
app.use('/cricket', express.json({ limit: '16kb' }));

// Live: signaling JSON (CSRF token header ya body ke _csrf mein; sendBeacon body mein bhejta hai). Ye bhi csrf se pehle.
app.use('/live', express.json({ limit: '64kb' }));
// Live ki recording: host ka browser seedhi video bytes bhejta hai (CSRF token header x-csrf-token mein). Ye bhi csrf se pehle.
app.post('/live/:id/recording', express.raw({ type: ['video/mp4', 'video/webm'], limit: config.liveRecordMaxMb + 'mb' }));

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
  res.locals.liveCanStart = !!(req.session.user && (!config.liveAdminOnly || res.locals.isAdmin)); // post box ka "🔴 Live" button
  res.locals.liveMax = config.liveMaxViewers;
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
  res.locals.googleVerification = config.googleVerification;
  res.locals.bingVerification = config.bingVerification;
  res.locals.yandexVerification = config.yandexVerification;
  res.locals.twitterHandle = config.twitterHandle;
  res.locals.googleEnabled = google.enabled;
  res.locals.videoMaxMb = config.videoMaxMb;
  res.locals.countries = COUNTRY_LIST; // signup / edit-profile ke country dropdown

  // Open Graph defaults (post page inhein override karta hai)
  const base = config.siteUrl || `${req.protocol}://${req.get('host')}`;
  res.locals.ogUrl = base + req.path.replace(/\/+$/, ''); // trailing slash ke baghair (canonical)
  // Default share image: .env ki DEFAULT_OG_IMAGE, warna khud bana hua site card
  res.locals.ogImage = config.defaultOgImage || (card.isAvailable() ? base + '/og/site.png' : null);
  res.locals.ogImageCard = !config.defaultOgImage && card.isAvailable();
  res.locals.ogType = 'website';
  res.locals.safeJson = safeJson;
  res.locals.jsonLd = req.path === '/'
    ? siteLd({
        base, siteName: config.siteName, description: res.locals.metaDescription,
        logo: card.isAvailable() ? base + '/icons/512.png' : null,
        sameAs: [config.facebookUrl, config.whatsappChannelUrl, ...config.socialLinks].filter((u) => /^https:\/\//i.test(u || '')),
      })
    : [];

  res.locals.unreadCount = 0;
  res.locals.navCategories = [];
  res.locals.currentPath = req.path;
  // Masthead ki tareekh (English), site ke timezone mein, jaise "Tuesday, 6 October 2026"
  try {
    const tz = config.timezone || 'Asia/Karachi';
    const now = new Date();
    res.locals.todayLabel = `${now.toLocaleDateString('en-US', { weekday: 'long', timeZone: tz })}, ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: tz })}`;
  } catch (e) { res.locals.todayLabel = ''; }
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


  // Headlines bar (V35): sirf page (HTML) wali GET requests par; category cookie / page ki category ke mutabiq
  res.locals.newsBar = null;
  if (req.method === 'GET' && !/^\/(img|video|a|icons|live|calls|stories|cricket\/bar|headlines\.json)(\/|$)/.test(req.path) && !/\.(json|xml|png|jpg|js|webmanifest|txt)$/.test(req.path)) {
    try { res.locals.newsBar = await headlinesLib.forRequest(req); }
    catch (err) { console.error('headlines bar:', err.message); }
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

  // Parhe na gaye private messages (header ka 💬 badge). Alag try: migration_v15 na chali ho to site na ruke
  res.locals.unreadMessages = 0;
  if (req.session.user) {
    try {
      res.locals.unreadMessages = await messagesLib.unreadTotal(req.session.user.id);
    } catch (err) {
      console.error('unread messages count (migration_v15.sql chali?):', err.message);
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

  // Admin ke liye: kitni withdraw requests paid hone ka intezar kar rahi hain (alag try: migration_v29 na chali ho to site na ruke)
  res.locals.pendingPayouts = 0;
  if (res.locals.isAdmin && config.earnEnabled) {
    try {
      res.locals.pendingPayouts = await earningsLib.pendingCount();
    } catch (err) {
      console.error('pending payouts count (migration_v29.sql chali?):', err.message);
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

  // V39: ad slots. Only normal page GETs; a missing migration_v39 never breaks the site (own try)
  res.locals.adBanner = null;
  res.locals.feedAd = null;
  res.locals.pendingAds = 0;
  if (req.method === 'GET' && !req.query.partial && !/^\/(img|video|a|icons|live|calls|stories|cricket\/bar|ads|admin|advertise)(\/|$)/.test(req.path)) {
    try {
      const place = adsLib.placeOf(req.path, req.query);
      if (place) {
        const shown = [];
        res.locals.adBanner = await adsLib.bannerFor(req);
        if (res.locals.adBanner) shown.push(res.locals.adBanner);
        if (req.path === '/' && place === 'feed' && !req.query.before) {
          res.locals.feedAd = await adsLib.feedAdFor();
          if (res.locals.feedAd && !(res.locals.adBanner && res.locals.adBanner.id === res.locals.feedAd.id)) shown.push(res.locals.feedAd);
        }
        if (shown.length) adsLib.recordViews(req, shown);
      }
    } catch (err) {
      console.error('ad slots (migration_v39.sql chali?):', err.message);
    }
  }
  // Admin: ads and wallet top-ups waiting for a decision (header badge)
  if (res.locals.isAdmin) {
    try { res.locals.pendingAds = await adsLib.pendingCount(); }
    catch (err) { console.error('pending ads count (migration_v39.sql chali?):', err.message); }
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
app.use('/', courtRouter);
app.use('/', petitionsRouter);
app.use('/', creatorsRouter);
app.use('/', trendsRouter);
app.use('/', cricketRouter);
app.use('/', headlinesRouter);
app.use('/', profileRouter);
app.use('/', friendsRouter);
app.use('/', messagesRouter);
app.use('/', callsRouter);
app.use('/', liveRouter);
app.use('/', avatarRouter);
app.use('/', moderationRouter);
app.use('/', homeRouter); // akhbar jaisa home page; feed ke query params aayein to feedRouter ko de deta hai
app.use('/', feedRouter);
app.use('/', storiesRouter);
app.use('/', groupsRouter);
app.use('/', earningsRouter);
app.use('/', adsRouter);
app.use('/', authRouter);

app.use((req, res) => {
  res.status(404).render('404', { title: 'Not Found' });
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    if (/^\/live\/\d+\/recording$/.test(req.path)) return res.status(413).json({ error: `Recording is too large (max ${config.liveRecordMaxMb} MB).` });
    const isVideo = req.path === '/upload-video';
    return res.status(413).json({
      error: isVideo ? `Video is too large (max ${config.videoMaxMb} MB).` : req.path === '/upload-feed-image' ? 'Photo is too large. Please choose a smaller one.' : 'Image is too large (max 5 MB).',
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
  startCourtScheduler(); // People's Court: jury ka waqt khatam hone par faisla + notifications (+ Telegram)
  startTelegramPoster(); // naya contest / result Telegram channel mein (token set ho to)
  startStoryCleaner(); // 24 ghante purani stories (aur un ki photos) hata deta hai
  startFollowNotifier(); // followers ko naya post / contest ki notification (+ email)
});
