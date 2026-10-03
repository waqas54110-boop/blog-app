// Community feed post ke liye SEO helpers: title, meta description aur structured data (JSON-LD).
// Title mein username nahi aata aur "..." se kata hua nahi hota (Google ko saaf, mukammal title chahiye).

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// Lafz ki hadd par kaat-ta hai (beech lafz mein nahi), baghair "..." ke
function cut(s, max) {
  s = clean(s);
  if (s.length <= max) return s;
  const part = s.slice(0, max + 1);
  const i = part.lastIndexOf(' ');
  return (i > max * 0.6 ? part.slice(0, i) : s.slice(0, max)).replace(/[\s,;:\-–—(]+$/, '');
}

// Post ka pehla jumla / pehli line = headline (max ~70 chars). Pehli line chhoti ho (<=70) to wahi poori headline banti hai
function headline(body, max = 70) {
  const first = String(body || '').split(/\n/).map(clean).find(Boolean) || '';
  if (!first) return '';
  if (first.length <= max) return first.replace(/[.!?؟]+$/, '');
  const sentence = first.match(/^(.+?[.!?؟])(\s|$)/);
  const base = sentence && sentence[1].length >= 25 ? sentence[1].replace(/[.!?؟]+$/, '') : first;
  return cut(base, max);
}

// Agar pehli line hi headline hai (chhoti line), to description/alt mein usay dobara nahi dohrate
function restAfterHeadline(body) {
  const lines = String(body || '').split(/\n/).map(clean);
  const i = lines.findIndex(Boolean);
  if (i === -1) return '';
  const first = lines[i];
  if (first.length <= 70 && lines.slice(i + 1).some(Boolean)) {
    return lines.slice(i + 1).filter(Boolean).join(' ');
  }
  return clean(body);
}

// Meta description: ~155 chars, poore lafzon par khatam
function description(body, max = 155) {
  const text = restAfterHeadline(body);
  if (!text) return '';
  if (text.length <= max) return text;
  return cut(text, max - 1) + '…';
}

// Image ka alt text (screen reader + Google Images): post ka matn, warna "Photo posted by X"
function imageAlt(body, username) {
  const h = headline(body, 110);
  const t = h || cut(body, 110);
  return t || `Photo posted by ${username}`;
}

const iso = (d) => new Date(d).toISOString();

// SocialMediaPosting = feed post ki sahi schema type (NewsArticle sirf asli /blog articles ke liye theek hai)
function feedLd({ base, siteName, f, head, desc, image, comments }) {
  const url = `${base}/feed/${f.id}`;
  const post = {
    '@context': 'https://schema.org',
    '@type': 'SocialMediaPosting',
    '@id': url + '#post',
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    headline: head || `Post by ${f.username}`,
    ...(desc ? { description: desc } : {}),
    articleBody: clean(f.body),
    datePublished: iso(f.created_at),
    dateModified: iso(f.created_at),
    inLanguage: 'en',
    author: { '@type': 'Person', name: f.username, url: `${base}/u/${encodeURIComponent(f.username)}` },
    publisher: { '@type': 'Organization', name: siteName, url: base },
    ...(image ? { image: [image] } : {}),
    interactionStatistic: [
      { '@type': 'InteractionCounter', interactionType: 'https://schema.org/LikeAction', userInteractionCount: f.likes || 0 },
      { '@type': 'InteractionCounter', interactionType: 'https://schema.org/CommentAction', userInteractionCount: f.comments || 0 },
      { '@type': 'InteractionCounter', interactionType: 'https://schema.org/ViewAction', userInteractionCount: f.views || 0 },
    ],
    ...(comments && comments.length
      ? {
          comment: comments.slice(0, 20).map((c) => ({
            '@type': 'Comment',
            text: clean(c.body).slice(0, 500),
            dateCreated: iso(c.created_at),
            author: { '@type': 'Person', name: c.username },
          })),
        }
      : {}),
  };

  const crumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: base + '/' },
      { '@type': 'ListItem', position: 2, name: 'Community', item: base + '/community' },
      { '@type': 'ListItem', position: 3, name: head || `Post by ${f.username}`, item: url },
    ],
  };

  return [post, crumbs];
}

module.exports = { headline, description, imageAlt, feedLd, cut };
