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

function postLd({ base, siteName, post, description, image, tags, content }) {
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
    author: { '@type': 'Person', name: post.username },
    publisher: { '@type': 'Organization', name: siteName, url: base },
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
function siteLd({ base, siteName, description }) {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: siteName,
      url: base + '/',
      description,
      potentialAction: {
        '@type': 'SearchAction',
        target: `${base}/?q={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    },
  ];
}

module.exports = { postLd, siteLd, safeJson };
