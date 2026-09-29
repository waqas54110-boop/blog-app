// Saari settings ek jagah. Values .env / Render environment se aati hain.
module.exports = {
  // Apne groups banane ke baad .env mein ye links daal dein
  whatsappUrl: process.env.COMMUNITY_WHATSAPP_URL || 'https://chat.whatsapp.com/REPLACE_WITH_YOUR_INVITE_LINK',
  facebookUrl: process.env.COMMUNITY_FACEBOOK_URL || 'https://facebook.com/groups/REPLACE_WITH_YOUR_GROUP',
  whatsappChannelUrl: process.env.WHATSAPP_CHANNEL_URL || '', // optional
  siteUrl: (process.env.SITE_URL || '').replace(/\/$/, ''),   // e.g. https://myblog.onrender.com
  siteName: process.env.SITE_NAME || 'My Blog',
  timezone: process.env.SITE_TIMEZONE || 'Asia/Karachi',      // scheduled posts is timezone mein
  defaultOgImage: process.env.DEFAULT_OG_IMAGE || '',
};
