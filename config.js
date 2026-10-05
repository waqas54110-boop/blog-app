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
};
