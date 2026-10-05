// Saari settings ek jagah. Values .env / Render environment se aati hain.
module.exports = {
  // Apne groups banane ke baad .env mein ye links daal dein
  whatsappUrl: process.env.COMMUNITY_WHATSAPP_URL || 'https://chat.whatsapp.com/DlUFKzSudp04uMWdCSgA6L',
  facebookUrl: process.env.COMMUNITY_FACEBOOK_URL || 'https://www.facebook.com/share/g/1C24sSdqZK/',
  whatsappChannelUrl: process.env.WHATSAPP_CHANNEL_URL || '', // optional
  siteUrl: (process.env.SITE_URL || '').replace(/\/$/, ''),   // e.g. https://myblog.onrender.com
  siteName: process.env.SITE_NAME || 'Khabzo',
  timezone: process.env.SITE_TIMEZONE || 'Asia/Karachi',      // scheduled posts is timezone mein
  // Google Search Console verification (HTML tag wale tareeqe ka "content" wala hissa)
  googleVerification: (process.env.GOOGLE_SITE_VERIFICATION || '').replace(/[^A-Za-z0-9_-]/g, ''),
  // Bing Webmaster Tools / Yandex verification (meta tag ka "content" wala hissa)
  bingVerification: (process.env.BING_SITE_VERIFICATION || '').replace(/[^A-Za-z0-9_-]/g, ''),
  yandexVerification: (process.env.YANDEX_SITE_VERIFICATION || '').replace(/[^A-Za-z0-9_-]/g, ''),
  // X (Twitter) handle, bina @ ke (khali = tag nahi lagta)
  twitterHandle: (process.env.TWITTER_HANDLE || '').replace(/[^A-Za-z0-9_]/g, ''),
  // Aap ke social profiles (comma se alag, poore https links): Google ko batata hai ke ye sab aap hi ke hain
  socialLinks: (process.env.SOCIAL_LINKS || '').split(',').map((s) => s.trim()).filter((s) => /^https:\/\//i.test(s)).slice(0, 10),
  // 1 likhein: SITE_URL ke ilawa kisi aur domain (www, railway.app) par aane walon ko 301 se asli domain par bhej do
  forceCanonicalHost: process.env.FORCE_CANONICAL_HOST === '1',
  defaultOgImage: process.env.DEFAULT_OG_IMAGE || '',
  // Video upload ki hadd (MB). Videos database mein save hoti hain, is liye chhoti rakhein (max 100)
  videoMaxMb: Math.min(Math.max(parseInt(process.env.VIDEO_MAX_MB, 10) || 30, 1), 100),
  // "Hire Me" page: services ki list (comma se alag) aur inquiry kis email par aaye (khali = admin ki email)
  hireServices: (process.env.HIRE_SERVICES || 'Video Editing, Web Development, Odoo Customization, Content Creation, Other')
    .split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10),
  inquiryEmail: process.env.INQUIRY_EMAIL || '',
  // Telegram channel mein contest khud post karne ke liye (dono khali = band)
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChat: process.env.TELEGRAM_CHAT_ID || '',   // @channelname ya -100xxxxxxxxxx
  // Groups: 1 likhein to naya group sirf admin bana sakta hai (default: har login user, max 5 groups)
  groupsAdminOnly: process.env.GROUPS_ADMIN_ONLY === '1',
  // Live broadcasting: ek live mein ek saath kitne log dekh sakte hain (host ka upload = har viewer ke liye alag, is liye chhota rakhein)
  liveMaxViewers: Math.min(Math.max(parseInt(process.env.LIVE_MAX_VIEWERS, 10) || 6, 1), 15),
  // 1 likhein to live sirf admin kar sakta hai (default: har login user)
  liveAdminOnly: process.env.LIVE_ADMIN_ONLY === '1',
  // Bari audience: LiveKit (media server). Teeno set hon to live "sfu" mode mein chalta hai (sab viewers ek hi server se dekhte hain).
  livekitUrl: process.env.LIVEKIT_URL || '',            // wss://your-project.livekit.cloud
  livekitKey: process.env.LIVEKIT_API_KEY || '',
  livekitSecret: process.env.LIVEKIT_API_SECRET || '',
  // LiveKit mode mein ek live ke max viewers (aap ke LiveKit plan ki hadd bhi lagti hai)
  liveSfuMaxViewers: Math.min(Math.max(parseInt(process.env.LIVE_SFU_MAX_VIEWERS, 10) || 200, 1), 2000),
  // Live ki recording ki hadd (MB). Recording database mein save hoti hai. 0 = recording band
  liveRecordMaxMb: Math.min(Math.max(isNaN(parseInt(process.env.LIVE_RECORD_MAX_MB, 10)) ? 60 : parseInt(process.env.LIVE_RECORD_MAX_MB, 10), 0), 200),
  // V29: Creators ki kamayi. EARN_ENABLED=1 likhne par hi chalti hai (default band)
  earnEnabled: process.env.EARN_ENABLED === '1',
  // Ek view ke kitne paisa. 1 paisa = 100 views par Rs 1 (default)
  earnPaisaPerView: Math.min(Math.max(parseInt(process.env.EARN_PAISA_PER_VIEW, 10) || 1, 1), 100),
  // Kam az kam withdraw (rupees)
  earnMinWithdrawRs: Math.min(Math.max(parseInt(process.env.EARN_MIN_WITHDRAW_RS, 10) || 500, 1), 100000),
  // Ek user ki roz ki zyada se zyada kamayi (rupees). 0 = koi hadd nahi
  earnDailyCapRs: Math.min(Math.max(isNaN(parseInt(process.env.EARN_DAILY_CAP_RS, 10)) ? 200 : parseInt(process.env.EARN_DAILY_CAP_RS, 10), 0), 1000000),
  // V30: Blog post parhne ka inaam. Post par itne seconds (screen par, kuch karte hue) rehna zaroori, har post sirf ek baar
  earnReadSeconds: Math.min(Math.max(parseInt(process.env.EARN_READ_SECONDS, 10) || 60, 20), 600),
  // Ek post parhne ke kitne paisa (5 = Rs 0.05)
  earnReadPaisa: Math.min(Math.max(parseInt(process.env.EARN_READ_PAISA, 10) || 5, 1), 1000),
  // Parhne se ek user roz zyada se zyada kitne rupees kama sakta hai
  earnReadDailyCapRs: Math.min(Math.max(isNaN(parseInt(process.env.EARN_READ_DAILY_CAP_RS, 10)) ? 10 : parseInt(process.env.EARN_READ_DAILY_CAP_RS, 10), 1), 100000),
  // Ek qualified invite (dost jo email verify kare aur vote / comment wagaira kare) ke kitne paisa (100 = Rs 1, yani 10 dost = Rs 10)
  earnInvitePaisa: Math.min(Math.max(parseInt(process.env.EARN_INVITE_PAISA, 10) || 100, 1), 10000),
  // Invite se ek user zyada se zyada kitne doston ka inaam le sakta hai
  earnInviteMax: Math.min(Math.max(isNaN(parseInt(process.env.EARN_INVITE_MAX, 10)) ? 100 : parseInt(process.env.EARN_INVITE_MAX, 10), 1), 100000),
};
