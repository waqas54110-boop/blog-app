// Google ke liye structured data (JSON-LD). Page ke <head> mein jata hai (header.ejs).

// JSON ko <script> ke andar safe banata hai (</script> wagera se bachne ke liye)
const safeJson = (obj) =>
  JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

const iso = (d) => new Date(d).toISOString();

// Publisher (logo ke saath): Google ko site ki pehchan
const publisher = (base, siteName, logo) => ({
  '@type': 'Organization',
  name: siteName,
  url: base,
  ...(logo ? { logo: { '@type': 'ImageObject', url: logo } } : {}),
});

function postLd({ base, siteName, post, description, image, tags, content, logo }) {
  const url = `${base}/posts/${post.slug}`;
  const words = String(content || '').trim().split(/\s+/).filter(Boolean).length;

  const article = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    headline: String(post.title).slice(0, 110),
    description,
    ...(image ? { image: [image] } : {}),
    datePublished: iso(post.publish_at),
    dateModified: iso(post.updated_at || post.publish_at),
    author: { '@type': 'Person', name: post.username, url: `${base}/u/${encodeURIComponent(post.username)}` },
    publisher: publisher(base, siteName, logo),
    inLanguage: 'en',
    isAccessibleForFree: true,
    timeRequired: `PT${Math.max(Math.ceil(words / 200), 1)}M`,
    articleSection: post.category,
    ...(tags && tags.length ? { keywords: tags.join(', ') } : {}),
    wordCount: words,
  };

  const crumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: base + '/' },
      {
        '@type': 'ListItem',
        position: 2,
        name: post.category,
        item: `${base}/?category=${encodeURIComponent(post.category)}`,
      },
      { '@type': 'ListItem', position: 3, name: post.title, item: url },
    ],
  };

  return [article, crumbs];
}

// Home page: Google ko batata hai ke site ke andar search hai
function siteLd({ base, siteName, description, logo, sameAs }) {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': base + '/#organization',
      name: siteName,
      url: base + '/',
      ...(logo ? { logo: { '@type': 'ImageObject', url: logo } } : {}),
      ...(sameAs && sameAs.length ? { sameAs } : {}),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: siteName,
      url: base + '/',
      description,
      inLanguage: 'en',
      publisher: { '@id': base + '/#organization' },
      potentialAction: {
        '@type': 'SearchAction',
        target: `${base}/blog?q={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    },
  ];
}

// Blog / category / tag listing: CollectionPage + ItemList (Google ko list ki har post ka link milta hai)
function listLd({ base, name, url, description, posts, crumbs }) {
  const out = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name,
      url,
      description,
      inLanguage: 'en',
      isPartOf: { '@type': 'WebSite', url: base + '/' },
      mainEntity: {
        '@type': 'ItemList',
        itemListElement: posts.map((p, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: `${base}/posts/${p.slug}`,
          name: p.title,
        })),
      },
    },
  ];
  if (crumbs && crumbs.length) {
    out.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url })),
    });
  }
  return out;
}

// Public profile: ProfilePage
function profileLd({ base, siteName, username, bio, image }) {
  const url = `${base}/u/${encodeURIComponent(username)}`;
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'ProfilePage',
      url,
      isPartOf: { '@type': 'WebSite', name: siteName, url: base + '/' },
      mainEntity: {
        '@type': 'Person',
        name: username,
        url,
        ...(bio ? { description: String(bio).slice(0, 200) } : {}),
        ...(image ? { image } : {}),
      },
    },
  ];
}

module.exports = { postLd, siteLd, listLd, profileLd, safeJson };
