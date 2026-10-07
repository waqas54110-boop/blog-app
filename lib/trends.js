// Trend Radar (V38): what is trending in Pakistan right now + ideas for a YouTube / TikTok creator.
// Data: YouTube Data API v3 (mostPopular, regionCode=PK) and the public Google Trends PK RSS feed.
// TikTok has no public trending API, so for TikTok the topics come from Google / YouTube trends in Pakistan
// and hashtag ideas are generated; the report says so openly.
// AI write-up (optional): Anthropic API, only if ANTHROPIC_API_KEY is set.
const pool = require('../db');

const YT_KEY = process.env.YOUTUBE_API_KEY || '';
const AI_KEY = process.env.ANTHROPIC_API_KEY || '';
const AI_MODEL = process.env.TRENDS_AI_MODEL || 'claude-sonnet-5-5';
const REPORT_TTL_H = 3;
const AI_TTL_H = 6;
const AI_DAILY_CAP = Math.min(Math.max(parseInt(process.env.TRENDS_AI_DAILY_CAP, 10) || 30, 0), 1000);
const SEARCH_DAILY_CAP = Math.min(Math.max(parseInt(process.env.TRENDS_SEARCH_DAILY_CAP, 10) || 40, 0), 90);

// match: niche se related words; seeds: evergreen topics agar trending data kam ho
const NICHES = {
  cricket:   { label: 'Cricket',   cat: '17', match: /cricket|psl|t20|odi|test match|babar|rizwan|shaheen|afridi|pcb|icc|bat|bowl|wicket|ipl|asia cup|world cup/i, seeds: ['Street cricket batting tips', 'Fast bowling at home', 'Best PSL moments', 'Cricket rules most people get wrong'], tags: ['cricket', 'psl', 'cricketlovers', 'streetcricket'] },
  tech:      { label: 'Tech',      cat: '28', match: /iphone|android|samsung|ai|chatgpt|app|phone|laptop|windows|google|tech|mobile|gadget|software|openai|claude/i, seeds: ['Best budget phones in Pakistan', 'AI tools that save time', 'Phone tricks nobody uses', 'Laptop buying guide'], tags: ['tech', 'ai', 'mobile', 'techpakistan'] },
  comedy:    { label: 'Comedy',    cat: '23', match: /funny|comedy|prank|meme|skit|roast|joke/i, seeds: ['Desi family skits', 'Relatable office humour', 'Exam season memes', 'Shaadi season problems'], tags: ['funny', 'comedy', 'desihumor', 'relatable'] },
  news:      { label: 'News',      cat: '25', match: /./, seeds: ['Today in 60 seconds', 'Explained simply: this week\'s big story', 'Fact check: viral claim', 'What happens next?'], tags: ['news', 'pakistan', 'breaking', 'explained'] },
  gaming:    { label: 'Gaming',    cat: '20', match: /game|gaming|pubg|minecraft|fortnite|gta|fifa|ps5|xbox|valorant|free fire|roblox|esports/i, seeds: ['Best mobile games for low-end phones', 'PUBG tips for beginners', 'Game review in 3 minutes', 'Funny gaming moments'], tags: ['gaming', 'pubg', 'mobilegaming', 'gamer'] },
  education: { label: 'Education', cat: '27', match: /exam|result|admission|university|scholarship|study|board|merit|entry test|mdcat|ecat|css|degree/i, seeds: ['How to study with less stress', 'Scholarships you can apply for', 'Free skills to learn this year', 'Exam preparation plan'], tags: ['education', 'study', 'students', 'learning'] },
  music:     { label: 'Music',     cat: '10', match: /song|music|singer|album|coke studio|concert|rap|lyrics|ost/i, seeds: ['Coke Studio style cover', 'Learn a song on guitar', 'Beginner singing tips', 'Underrated Pakistani songs'], tags: ['music', 'cover', 'singer', 'pakistanimusic'] },
  vlogs:     { label: 'Vlogs / Lifestyle', cat: '22', match: /vlog|travel|trip|life|routine|day in|home|shopping|wedding/i, seeds: ['A day in my life in Lahore', 'Weekend trip under Rs 5000', 'Morning routine', 'Ramadan / Eid preparation'], tags: ['vlog', 'dayinmylife', 'lifestyle', 'pakistan'] },
  food:      { label: 'Food',      cat: null, q: 'food recipe', match: /food|recipe|biryani|karahi|chai|cooking|restaurant|street food|dessert|burger/i, seeds: ['Street food tour', 'Easy 15 minute dinner', 'Biryani secrets', 'Budget meals for the week'], tags: ['food', 'recipe', 'streetfood', 'foodie'] },
  business:  { label: 'Business / Freelancing', cat: null, q: 'business freelancing', match: /business|freelanc|startup|money|invest|stock|dollar|rupee|price|petrol|gold|earn|upwork|fiverr/i, seeds: ['Freelancing for beginners', 'Small business ideas under Rs 50,000', 'How to get your first client', 'Money mistakes to avoid'], tags: ['business', 'freelancing', 'earnonline', 'startup'] },
  entertainment: { label: 'Entertainment', cat: '24', match: /drama|film|movie|actor|actress|series|netflix|trailer|episode|celebrity|show/i, seeds: ['Drama review without spoilers', 'Movie trailer reaction', 'Behind the scenes stories', 'Best dramas to binge'], tags: ['entertainment', 'drama', 'movies', 'review'] },
};
const PLATFORMS = ['youtube', 'tiktok'];

const STOP = new Set(('the a an and or of to in on for with is are was were be this that it its at by from as you your i my me we our they their he she his her not no yes how what why when who which will can do does did just new best vs top full video official live hd 4k ' +
  'ka ki ke ko se me mein hai hain ho tha thi to ye woh wo aur par ya bhi kya kyun kaise ab aaj').split(' '));

const now = () => Date.now();
const dayKey = () => new Date().toISOString().slice(0, 10);
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40);

async function cacheGet(key, ttlHours) {
  try {
    const r = await pool.query(`SELECT payload, fetched_at FROM trend_cache WHERE cache_key = $1 AND fetched_at > now() - ($2 || ' hours')::interval`, [key, String(ttlHours)]);
    return r.rows[0] ? { payload: r.rows[0].payload, fetchedAt: r.rows[0].fetched_at } : null;
  } catch (e) { console.error('[trends] cache read (migration_v38.sql chali?):', e.message); return null; }
}
async function cacheSet(key, payload) {
  try {
    await pool.query(
      `INSERT INTO trend_cache (cache_key, payload, fetched_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (cache_key) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now()`, [key, JSON.stringify(payload)]);
  } catch (e) { console.error('[trends] cache write:', e.message); }
}
// Roz ka counter (search quota / AI kharcha): true agar abhi bhi hadd ke andar
async function bump(prefix, max) {
  if (max <= 0) return false;
  const key = `${prefix}:${dayKey()}`;
  try {
    const r = await pool.query(
      `INSERT INTO trend_cache (cache_key, payload, fetched_at) VALUES ($1, '{"n":1}'::jsonb, now())
       ON CONFLICT (cache_key) DO UPDATE SET payload = jsonb_build_object('n', COALESCE((trend_cache.payload->>'n')::int, 0) + 1), fetched_at = now()
       RETURNING (payload->>'n')::int AS n`, [key]);
    return r.rows[0].n <= max;
  } catch (e) { return false; }
}

async function getJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(9000) });
  if (!res.ok) { const t = await res.text().catch(() => ''); const err = new Error(`HTTP ${res.status} ${t.slice(0, 160)}`); err.status = res.status; throw err; }
  return res.json();
}

// ---------- YouTube ----------
const secs = (iso) => { const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || ''); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };
function mapVideo(v) {
  const sn = v.snippet || {}, st = v.statistics || {};
  const published = sn.publishedAt ? new Date(sn.publishedAt).getTime() : now();
  const hours = Math.max(1, (now() - published) / 3600000);
  const views = parseInt(st.viewCount, 10) || 0;
  return {
    id: v.id, title: String(sn.title || '').slice(0, 140), channel: String(sn.channelTitle || '').slice(0, 60),
    views, likes: parseInt(st.likeCount, 10) || 0, vph: Math.round(views / hours),
    durationSec: secs((v.contentDetails || {}).duration), publishedAt: sn.publishedAt || null,
    tags: (sn.tags || []).slice(0, 15), desc: String(sn.description || '').slice(0, 400),
  };
}
async function ytVideosByIds(ids) {
  const u = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${ids.join(',')}&key=${YT_KEY}`;
  return (await getJson(u)).items.map(mapVideo);
}
async function youtubePopular(niche, keyword) {
  if (!YT_KEY) return { videos: [], note: 'YOUTUBE_API_KEY is not set, so live YouTube data is missing.' };
  const cfg = NICHES[niche];
  try {
    if (keyword || !cfg.cat) {
      const q = keyword || cfg.q || cfg.label;
      if (await bump('yt-search', SEARCH_DAILY_CAP)) {
        const after = new Date(now() - 7 * 86400000).toISOString();
        const s = await getJson(`https://www.googleapis.com/youtube/v3/search?part=id&type=video&regionCode=PK&order=viewCount&maxResults=25&publishedAfter=${encodeURIComponent(after)}&q=${encodeURIComponent(q)}&key=${YT_KEY}`);
        const ids = s.items.map((i) => i.id && i.id.videoId).filter(Boolean);
        if (ids.length) return { videos: (await ytVideosByIds(ids)).sort((a, b) => b.vph - a.vph), note: '' };
      }
    }
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&chart=mostPopular&regionCode=PK&maxResults=40${cfg.cat && !keyword ? '&videoCategoryId=' + cfg.cat : ''}&key=${YT_KEY}`;
    let items;
    try { items = (await getJson(url)).items.map(mapVideo); }
    catch (e) { // kuch categories PK mein chart nahi deti: general chart se kaam chalao
      if (e.status === 400 || e.status === 404) items = (await getJson(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&chart=mostPopular&regionCode=PK&maxResults=40&key=${YT_KEY}`)).items.map(mapVideo);
      else throw e;
    }
    if (keyword) { const re = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); const f = items.filter((v) => re.test(v.title + ' ' + v.tags.join(' '))); if (f.length >= 3) items = f; }
    return { videos: items, note: '' };
  } catch (e) {
    console.error('[trends] youtube:', e.message);
    return { videos: [], note: 'YouTube data could not be loaded right now (quota or key problem).' };
  }
}

// ---------- Google Trends PK (public RSS) ----------
const xmlText = (s) => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
async function googleTrendsPK() {
  try {
    const res = await fetch('https://trends.google.com/trending/rss?geo=PK', { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KhabzoTrendRadar/1.0)' }, signal: AbortSignal.timeout(9000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
    return items.slice(0, 25).map((it) => {
      const g = (tag) => { const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(it); return m ? xmlText(m[1]) : ''; };
      return { title: g('title').slice(0, 80), traffic: g('ht:approx_traffic'), news: g('ht:news_item_title').slice(0, 140) };
    }).filter((t) => t.title);
  } catch (e) { console.error('[trends] google trends:', e.message); return []; }
}

// ---------- Report ----------
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const hourPK = (iso) => parseInt(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Karachi' }).format(new Date(iso)), 10) % 24;
const fmtHour = (h) => { const x = ((h % 24) + 24) % 24; const ap = x >= 12 ? 'PM' : 'AM'; const hh = x % 12 === 0 ? 12 : x % 12; return `${hh} ${ap}`; };

const TEMPLATES = [
  (t) => `${t}: 5 things nobody is telling you`,
  (t) => `${t} explained in 60 seconds`,
  (t) => `My honest reaction to ${t}`,
  (t) => `${t}: truth or myth? (Sach ya Jhoot)`,
  (t) => `I tried ${t} for 24 hours`,
  (t) => `${t} vs the old way: which one wins?`,
  (t) => `What ${t} means for Pakistan`,
  (t) => `${t}: beginner's guide (${new Date().getFullYear()})`,
  (t) => `Top 3 mistakes people make with ${t}`,
  (t) => `${t}: my prediction for next week`,
];

const TIPS = {
  youtube: {
    do: ['Make the title and thumbnail promise one clear thing, then deliver it in the first 15 seconds.', 'Add your own angle, experience or opinion to a trending topic. That is what makes it yours.', 'Post when your audience is online and keep a steady schedule (even 2 videos a week).', 'Reply to comments in the first hour: it tells YouTube people are engaged.', 'Use 3-5 relevant hashtags and put the main keyword near the start of the title.'],
    dont: ['Do not copy another creator\'s video, voice or thumbnail. That brings copyright strikes and no loyal audience.', 'Do not use misleading clickbait. People leave quickly and the video stops being shown.', 'Do not buy subscribers or join sub-for-sub groups. They never watch, your reach drops and your channel can be penalised.', 'Do not use music or clips you do not have rights to.', 'Do not chase every trend. Pick the ones that fit your niche.'],
  },
  tiktok: {
    do: ['Hook in the first 2 seconds: show the result or ask the question straight away.', 'Keep videos short and tight (15-30 seconds works well to start) and use trending sounds from TikTok\'s own library.', 'Post every day for 2 weeks and see which topic gets saves and shares, not only views.', 'Use 3-5 hashtags: one broad, a few niche-specific.', 'Add captions on screen, because many people watch without sound.'],
    dont: ['Do not re-upload other people\'s videos or videos with another app\'s watermark.', 'Do not use copyrighted music outside TikTok\'s sound library on a business account.', 'Do not buy followers or join follow-for-follow groups. It kills your reach.', 'Do not post a trend that has nothing to do with you just for views.', 'Do not share private information of other people.'],
  },
};

function buildReport({ platform, niche, keyword, videos, trending, note }) {
  const cfg = NICHES[niche];
  const vids = videos.slice(0, 25);
  // topWords: top video titles ke aam alfaz
  const freq = new Map();
  vids.forEach((v) => {
    new Set(v.title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w))).forEach((w) => freq.set(w, (freq.get(w) || 0) + 1));
  });
  const topWords = [...freq.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([word, count]) => ({ word, count }));

  // hashtags
  const tagFreq = new Map();
  vids.forEach((v) => {
    const found = (v.title + ' ' + v.desc).match(/#[\p{L}\p{N}_]{3,30}/gu) || [];
    found.concat(v.tags.slice(0, 5).map((t) => '#' + t.replace(/[^\p{L}\p{N}_]/gu, ''))).forEach((h) => { const k = h.toLowerCase(); if (k.length > 3) tagFreq.set(k, (tagFreq.get(k) || 0) + 1); });
  });
  let hashtags = [...tagFreq.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h).slice(0, 8);
  const base = cfg.tags.map((t) => '#' + t);
  hashtags = [...new Set([...base, ...hashtags])];
  if (platform === 'tiktok') hashtags = [...new Set(['#fyp', '#pakistan', ...hashtags])];
  hashtags = hashtags.slice(0, 12);

  // topics: pehle niche se milti trending searches, phir top words, phir seeds
  const rel = trending.filter((t) => cfg.match.test(t.title + ' ' + t.news));
  const topics = [];
  const seen = new Set();
  const add = (text, reason) => { const k = text.toLowerCase(); if (!seen.has(k) && text.length > 2) { seen.add(k); topics.push({ text, reason }); } };
  rel.slice(0, 5).forEach((t) => add(t.title, `Trending in Pakistan on Google${t.traffic ? ' (' + t.traffic + ' searches)' : ''}`));
  if (keyword) add(cap(keyword), 'Your keyword');
  vids.slice(0, 3).forEach((v) => add(v.title.replace(/\s*[|\-–—#].*$/, '').slice(0, 60), `Fast-growing video: about ${v.vph.toLocaleString('en-US')} views per hour`));
  topWords.filter((w) => w.word.length >= 4 && w.count >= 3).slice(0, 4).forEach((w) => add(cap(w.word), `Appears in ${w.count} of the top videos right now`));
  trending.filter((t) => !rel.includes(t)).slice(0, 2).forEach((t) => add(t.title, 'General trend in Pakistan (use it only if you can link it to your niche)'));
  cfg.seeds.forEach((s) => add(s, 'Evergreen idea for this niche'));

  const ideas = TEMPLATES.map((tpl, i) => {
    const t = topics[i % Math.max(1, topics.length)] || { text: cfg.label, reason: '' };
    return { title: tpl(t.text), why: t.reason };
  });

  // posting time
  const hrs = vids.filter((v) => v.publishedAt).map((v) => hourPK(v.publishedAt));
  let bestTime;
  if (platform === 'youtube' && hrs.length >= 8) {
    const hist = new Array(24).fill(0); hrs.forEach((h) => { hist[h]++; });
    const best = hist.map((n, h) => ({ n, h })).sort((a, b) => b.n - a.n).slice(0, 2).map((x) => x.h).sort((a, b) => a - b);
    bestTime = `Most of today's fast-growing videos were published around ${best.map(fmtHour).join(' and ')} (Pakistan time). Try posting 1-2 hours before your audience is most active, then check your own analytics after 2 weeks.`;
  } else {
    bestTime = 'Pakistani audiences are usually most active in the evening, roughly 7 PM to 10 PM, and again around lunch break. Test two time slots for two weeks and keep the one that gets more views in the first hour.';
  }
  const len = median(vids.map((v) => v.durationSec).filter(Boolean));
  const shortShare = vids.length ? Math.round((vids.filter((v) => v.durationSec && v.durationSec <= 60).length * 100) / vids.length) : 0;
  const lengthNote = len ? `The median trending video is about ${len >= 90 ? Math.round(len / 60) + ' minutes' : len + ' seconds'} long${shortShare ? ' (' + shortShare + '% are Shorts of 60 seconds or less)' : ''}.` : '';

  const notes = [];
  if (platform === 'tiktok') notes.push('TikTok has no public trending data. Topics below come from Google and YouTube trends in Pakistan: they usually show up on TikTok too, but check TikTok\'s Discover page for the sounds and hashtags that are hot today.');
  if (note) notes.push(note);
  if (!trending.length) notes.push('Google Trends data could not be loaded right now.');

  return {
    generatedAt: new Date().toISOString(), platform, niche, nicheLabel: cfg.label, keyword: keyword || '',
    videos: vids.slice(0, 10).map((v) => ({ id: v.id, title: v.title, channel: v.channel, views: v.views, vph: v.vph, durationSec: v.durationSec })),
    trending: trending.slice(0, 12), rel: rel.slice(0, 6), topWords, hashtags, topics: topics.slice(0, 8), ideas,
    bestTime, lengthNote, tips: TIPS[platform], notes, hasYouTube: vids.length > 0,
  };
}

async function getReport({ platform, niche, keyword }) {
  const key = `rep:${platform}:${niche}:${slug(keyword)}`;
  const hit = await cacheGet(key, REPORT_TTL_H);
  if (hit) return { ...hit.payload, cached: true };
  const [yt, trending] = await Promise.all([youtubePopular(niche, keyword), googleTrendsPK()]);
  const report = buildReport({ platform, niche, keyword, videos: yt.videos, trending, note: yt.note });
  // Khali / nakaam report cache na karein (agle click par dobara koshish ho)
  if (report.hasYouTube || report.trending.length) await cacheSet(key, report);
  return { ...report, cached: false };
}

// ---------- AI write-up (optional) ----------
const LANGS = { english: 'clear, simple English', urdu: 'simple Urdu in Urdu script', roman: 'Roman Urdu (Urdu written in English letters), friendly and simple' };
const aiEnabled = () => !!AI_KEY && AI_DAILY_CAP > 0;

async function aiWriteup(report, lang) {
  if (!aiEnabled()) return { error: 'AI write-up is not switched on for this site.' };
  const L = LANGS[lang] ? lang : 'english';
  const key = `ai:${L}:${report.platform}:${report.niche}:${slug(report.keyword)}`;
  const hit = await cacheGet(key, AI_TTL_H);
  if (hit && hit.payload && hit.payload.text) return { text: hit.payload.text, cached: true };
  if (!(await bump('ai-count', AI_DAILY_CAP))) return { error: 'The AI write-up limit for today is used up. Please try again tomorrow, or use the report above.' };
  const data = {
    platform: report.platform, niche: report.nicheLabel, keyword: report.keyword, region: 'Pakistan',
    trending_searches: report.trending.slice(0, 10).map((t) => t.title + (t.traffic ? ` (${t.traffic})` : '')),
    top_videos: report.videos.slice(0, 8).map((v) => `${v.title} - ${v.views} views, ~${v.vph}/hour`),
    common_words: report.topWords.map((w) => w.word), hashtags: report.hashtags, best_time: report.bestTime, length: report.lengthNote,
  };
  const prompt = `You are a practical content coach for a new ${report.platform} creator in Pakistan in the "${report.nicheLabel}" niche. Using ONLY the data below, write a short action report in ${LANGS[L]}.

Sections (use markdown headings and short bullet points): 
1. What is trending right now and why it matters for this niche (3-5 bullets)
2. Ten video ideas, each with a catchy title and one line on the angle (original angle, never copying a creator)
3. Hashtags and title keywords to use
4. When and how often to post
5. Three things to avoid

Be honest: do not promise views or income, do not suggest buying subscribers or sub-for-sub. Do not invent numbers that are not in the data. Keep it under 450 words.

DATA:
${JSON.stringify(data)}`;
  try {
    const r = await getJson('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': AI_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: AI_MODEL, max_tokens: 1600, messages: [{ role: 'user', content: prompt }] }),
    });
    const text = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!text) return { error: 'The AI returned an empty answer. Please try again.' };
    await cacheSet(key, { text });
    return { text, cached: false };
  } catch (e) {
    console.error('[trends] ai:', e.message);
    return { error: 'The AI write-up failed right now. Please try again in a few minutes.' };
  }
}

module.exports = { buildReport, NICHES, PLATFORMS, getReport, aiWriteup, aiEnabled, hasYouTubeKey: !!YT_KEY, LANGS };
