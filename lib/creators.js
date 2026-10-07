// Creator Showcase (V38): link cleaning, niches, week helper.
// Sirf YouTube / TikTok ke links qabool hote hain (allow-list), baaqi sab reject.

const NICHES = ['Cricket', 'Tech', 'Comedy', 'News', 'Gaming', 'Education', 'Music', 'Vlogs', 'Food', 'Religion', 'Business', 'Other'];

const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);
const TT_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com']);

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

// Returns { ok, platform, kind, url, ytVideoId } ya { ok:false, error }
function parseLink(raw) {
  const text = String(raw || '').trim().slice(0, 300);
  if (!text) return { ok: false, error: 'Please paste your YouTube or TikTok link.' };
  let u;
  try { u = new URL(/^https?:\/\//i.test(text) ? text : 'https://' + text); } catch (e) { return { ok: false, error: 'That does not look like a valid link.' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, error: 'Only normal web links are allowed.' };
  if (u.username || u.password) return { ok: false, error: 'That link is not allowed.' };
  const host = u.hostname.toLowerCase();

  if (YT_HOSTS.has(host)) {
    // video: youtu.be/ID, /watch?v=ID, /shorts/ID, /live/ID
    let vid = null;
    if (host === 'youtu.be') vid = u.pathname.split('/')[1] || null;
    else if (u.pathname === '/watch') vid = u.searchParams.get('v');
    else { const m = u.pathname.match(/^\/(?:shorts|live|embed)\/([^/?#]+)/); if (m) vid = m[1]; }
    if (vid) {
      if (!ID_RE.test(vid)) return { ok: false, error: 'That YouTube video link looks broken.' };
      return { ok: true, platform: 'youtube', kind: 'video', url: 'https://www.youtube.com/watch?v=' + vid, ytVideoId: vid };
    }
    // channel: /@handle, /channel/UC..., /c/name, /user/name
    const m = u.pathname.match(/^\/(@[A-Za-z0-9._-]{2,60}|channel\/[A-Za-z0-9_-]{10,40}|c\/[^/?#]{1,60}|user\/[^/?#]{1,60})/);
    if (m) return { ok: true, platform: 'youtube', kind: 'channel', url: 'https://www.youtube.com/' + m[1], ytVideoId: null };
    return { ok: false, error: 'Please paste a YouTube channel link (youtube.com/@yourname) or a video link.' };
  }

  if (TT_HOSTS.has(host)) {
    if (host === 'vm.tiktok.com') {
      const code = u.pathname.split('/').filter(Boolean)[0];
      if (!code || !/^[A-Za-z0-9]{5,20}$/.test(code)) return { ok: false, error: 'That TikTok short link looks broken.' };
      return { ok: true, platform: 'tiktok', kind: 'video', url: 'https://vm.tiktok.com/' + code + '/', ytVideoId: null };
    }
    const prof = u.pathname.match(/^\/(@[A-Za-z0-9._]{2,40})\/?$/);
    if (prof) return { ok: true, platform: 'tiktok', kind: 'channel', url: 'https://www.tiktok.com/' + prof[1], ytVideoId: null };
    const vid = u.pathname.match(/^\/(@[A-Za-z0-9._]{2,40})\/video\/(\d{8,25})/);
    if (vid) return { ok: true, platform: 'tiktok', kind: 'video', url: 'https://www.tiktok.com/' + vid[1] + '/video/' + vid[2], ytVideoId: null };
    return { ok: false, error: 'Please paste your TikTok profile link (tiktok.com/@yourname) or a video link.' };
  }
  return { ok: false, error: 'Only YouTube and TikTok links are allowed here.' };
}

// "Subscribe" button ka link: YouTube channel ho to ?sub_confirmation=1 (YouTube khud poochta hai, koi zabardasti nahi)
function actionUrl(p) {
  if (p.platform === 'youtube' && p.kind === 'channel') return p.url + (p.url.includes('?') ? '&' : '?') + 'sub_confirmation=1';
  return p.url;
}

// Is hafte ka Monday (YYYY-MM-DD) site ke timezone mein
function weekStartSql(tzParam) {
  return `date_trunc('week', now() AT TIME ZONE ${tzParam})::date`;
}

module.exports = { NICHES, parseLink, actionUrl, weekStartSql };
