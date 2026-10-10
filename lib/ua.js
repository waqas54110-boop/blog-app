// User-Agent se: device / OS / browser / phone brand (insaan) aur bot ka naam + qism (bot).
// Koi package nahi chahiye.

// ---------- insaan: device ----------
function parseUA(ua) {
  ua = String(ua || '');
  const out = { device: 'desktop', os: 'Other', browser: 'Other', brand: null, inapp: false };

  // device
  if (/ipad|tablet|kindle|silk|playbook/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) out.device = 'tablet';
  else if (/iphone|ipod|android|mobi|windows phone|blackberry|opera mini/i.test(ua)) out.device = 'mobile';

  // OS
  if (/windows phone/i.test(ua)) out.os = 'Windows Phone';
  else if (/android/i.test(ua)) out.os = 'Android';
  else if (/iphone|ipad|ipod/i.test(ua)) out.os = 'iOS';
  else if (/windows/i.test(ua)) out.os = 'Windows';
  else if (/cros/i.test(ua)) out.os = 'ChromeOS';
  else if (/mac os x|macintosh/i.test(ua)) out.os = 'macOS';
  else if (/linux|ubuntu|x11/i.test(ua)) out.os = 'Linux';

  // browser (in-app browsers pehle: Facebook / Instagram / TikTok ke andar khulne wale)
  if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua)) { out.browser = 'Facebook app'; out.inapp = true; }
  else if (/Instagram/i.test(ua)) { out.browser = 'Instagram app'; out.inapp = true; }
  else if (/musical_ly|tiktok|bytedancewebview|trill_/i.test(ua)) { out.browser = 'TikTok app'; out.inapp = true; }
  else if (/Snapchat/i.test(ua)) { out.browser = 'Snapchat app'; out.inapp = true; }
  else if (/\bLine\//i.test(ua)) { out.browser = 'Line app'; out.inapp = true; }
  else if (/Twitter/i.test(ua)) { out.browser = 'X / Twitter app'; out.inapp = true; }
  else if (/Edg(e|A|iOS)?\//i.test(ua)) out.browser = 'Edge';
  else if (/OPR\/|Opera|OPT\//i.test(ua)) out.browser = 'Opera';
  else if (/SamsungBrowser/i.test(ua)) out.browser = 'Samsung Internet';
  else if (/UCBrowser|UCWEB/i.test(ua)) out.browser = 'UC Browser';
  else if (/MiuiBrowser|XiaoMi/i.test(ua)) out.browser = 'Mi Browser';
  else if (/HuaweiBrowser/i.test(ua)) out.browser = 'Huawei Browser';
  else if (/Firefox|FxiOS/i.test(ua)) out.browser = 'Firefox';
  else if (/CriOS|Chrome|Chromium/i.test(ua)) out.browser = /; wv\)/.test(ua) ? 'Android WebView' : 'Chrome';
  else if (/Safari/i.test(ua)) out.browser = 'Safari';
  if (out.browser === 'Android WebView') out.inapp = true;

  // phone brand (Pakistan mein aam: Samsung, Infinix, Tecno, Vivo, Oppo, Xiaomi, Realme, itel)
  if (out.os === 'iOS') out.brand = 'Apple';
  else if (out.os === 'Android') {
    if (/SM-[A-Z]\d|Samsung|GT-[A-Z]\d/i.test(ua)) out.brand = 'Samsung';
    else if (/Infinix/i.test(ua)) out.brand = 'Infinix';
    else if (/TECNO/i.test(ua)) out.brand = 'Tecno';
    else if (/itel/i.test(ua)) out.brand = 'itel';
    else if (/vivo|\bV2\d{3}[A-Z]?\b/i.test(ua)) out.brand = 'Vivo';
    else if (/OPPO|CPH\d{4}/i.test(ua)) out.brand = 'Oppo';
    else if (/realme|RMX\d{4}/i.test(ua)) out.brand = 'Realme';
    else if (/Xiaomi|Redmi|POCO|MI \d|\bM\d{4}[A-Z]\d{1,2}[A-Z]{1,2}\b|\b2\d{7}[A-Z]{1,2}\b/i.test(ua)) out.brand = 'Xiaomi';
    else if (/HUAWEI|Honor|\b[A-Z]{3}-L\d\d\b/i.test(ua)) out.brand = 'Huawei';
    else if (/Pixel/i.test(ua)) out.brand = 'Google';
    else if (/Nokia/i.test(ua)) out.brand = 'Nokia';
    else if (/Motorola|moto /i.test(ua)) out.brand = 'Motorola';
    else out.brand = 'Other Android';
  }
  return out;
}

// ---------- bots ----------
// Har entry: [regex, naam, qism]. Pehla match jeetta hai.
const BOT_RULES = [
  [/facebookexternalhit|facebookcatalog|Facebot/i, 'Facebook preview', 'social'],
  [/meta-externalagent|meta-externalfetcher/i, 'Meta crawler', 'social'],
  [/WhatsApp/i, 'WhatsApp preview', 'social'],
  [/TelegramBot/i, 'Telegram preview', 'social'],
  [/Twitterbot/i, 'X / Twitter preview', 'social'],
  [/LinkedInBot/i, 'LinkedIn preview', 'social'],
  [/Discordbot/i, 'Discord preview', 'social'],
  [/Slackbot|Slack-ImgProxy/i, 'Slack preview', 'social'],
  [/SkypeUriPreview/i, 'Skype preview', 'social'],
  [/Pinterest/i, 'Pinterest', 'social'],
  [/Googlebot|Google-InspectionTool|GoogleOther|AdsBot-Google|Mediapartners-Google|APIs-Google|Storebot-Google|Google-Read-Aloud|FeedFetcher-Google/i, 'Googlebot', 'search'],
  [/bingbot|BingPreview|msnbot/i, 'Bingbot', 'search'],
  [/YandexBot|YandexImages|Yandex/i, 'Yandex', 'search'],
  [/Baiduspider/i, 'Baidu', 'search'],
  [/DuckDuckBot|DuckDuckGo/i, 'DuckDuckGo', 'search'],
  [/Applebot/i, 'Applebot', 'search'],
  [/Slurp/i, 'Yahoo', 'search'],
  [/Bytespider/i, 'Bytespider (TikTok)', 'seo'],
  [/AhrefsBot/i, 'AhrefsBot', 'seo'],
  [/SemrushBot/i, 'SemrushBot', 'seo'],
  [/MJ12bot/i, 'Majestic', 'seo'],
  [/DotBot/i, 'DotBot', 'seo'],
  [/PetalBot/i, 'PetalBot (Huawei)', 'seo'],
  [/GPTBot|ChatGPT-User|OAI-SearchBot/i, 'OpenAI', 'ai'],
  [/ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai/i, 'Anthropic', 'ai'],
  [/PerplexityBot|Perplexity-User/i, 'Perplexity', 'ai'],
  [/CCBot/i, 'Common Crawl', 'ai'],
  [/Amazonbot/i, 'Amazonbot', 'ai'],
  [/UptimeRobot|Pingdom|StatusCake|Site24x7|BetterUptime|Better Stack|monitor/i, 'Uptime monitor', 'monitor'],
  [/Lighthouse|PageSpeed|GTmetrix|Chrome-Lighthouse/i, 'Speed test', 'monitor'],
  [/HeadlessChrome|PhantomJS|puppeteer|playwright|selenium/i, 'Headless browser', 'script'],
  [/curl\//i, 'curl', 'script'],
  [/wget/i, 'wget', 'script'],
  [/python-requests|python-urllib|aiohttp|httpx/i, 'Python script', 'script'],
  [/Go-http-client/i, 'Go script', 'script'],
  [/node-fetch|axios|got \(|undici/i, 'Node script', 'script'],
  [/Scrapy|libwww|Apache-HttpClient|Java\//i, 'Scraper', 'script'],
  [/preview/i, 'Link preview', 'social'],
];
// isBot ka asli regex (analytics.js isi ko use karta hai): pehle wali list + ye sab naam
const BOT_RE = new RegExp(
  '(bot|crawl|spider|slurp|preview|facebookexternalhit|facebookcatalog|facebot|whatsapp|headless|curl|wget|python-requests|python-urllib|' +
  'bytespider|semrush|ahrefs|mj12|dotbot|petalbot|yandex|baidu|duckduck|applebot|meta-external|discord|skypeuripreview|' +
  'go-http-client|scrapy|node-fetch|axios|libwww|apache-httpclient|java/|uptime|pingdom|lighthouse|pagespeed|gtmetrix|' +
  'perplexity|claude-user|chatgpt-user|oai-searchbot|aiohttp|httpx|undici)', 'i');

function isBotUA(ua) {
  ua = String(ua || '');
  if (!ua.trim()) return true; // bina User-Agent ke browser nahi hota
  return BOT_RE.test(ua);
}

function botInfo(ua) {
  ua = String(ua || '');
  if (!ua.trim()) return { bot: 'No User-Agent', kind: 'script' };
  for (const [re, bot, kind] of BOT_RULES) if (re.test(ua)) return { bot, kind };
  const m = ua.match(/([A-Za-z0-9_\-. ]{2,30}?(?:bot|crawler|spider))/i);
  return { bot: m ? m[1].trim().slice(0, 40) : 'Other bot', kind: 'other' };
}

module.exports = { parseUA, isBotUA, botInfo, BOT_RE };
