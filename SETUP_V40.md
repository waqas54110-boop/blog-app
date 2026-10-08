# V40 - Dashboard + Blog page redesign (full SEO)

Koi migration nahi chahiye (no SQL). Sirf files replace karo aur deploy karo.

## Files (apni project folder mein same jagah par replace karo)
- views/dashboard.ejs          -> naya admin dashboard
- views/index.ejs              -> naya /blog page
- views/partials/blog-card.ejs -> naya post card
- views/partials/header.ejs    -> rel="prev/next" tags add hue
- routes/posts.js              -> dashboard data (14-day visits, categories) + blog SEO data

## Deploy
    git add .
    git commit -m "V40: dashboard + blog redesign, SEO"
    git push

## Dashboard (/dashboard)
- Hero banner: greeting + quick buttons (Write post, Inbox, Analytics, Moderation)
- 6 colourful stat cards with icons
- 14-day visits chart (SVG, hover par date/visits)
- Top 5 posts, category bars
- Posts table: status tabs (All/Published/Drafts/Scheduled), live search, views bar,
  WhatsApp/Facebook copy buttons, Edit/Delete
- noindex,nofollow (admin page Google mein na aaye)

## Blog page (/blog) - SEO
- Visible breadcrumb + BreadcrumbList JSON-LD
- Har filter/category/tag/search page ka apna unique H1, title, description, canonical
- JSON-LD: CollectionPage + ItemList + BreadcrumbList + Blog (blogPost list)
- rel="prev"/"next" pagination links
- og:image / twitter:image = newest post ka cover; og:image:alt
- Card images: descriptive alt text, width/height (CLS fix), fetchpriority="high" featured image
- <time datetime>, schema.org BlogPosting microdata, tag/category links crawlable
- Search results noindex,follow (pehle se)
- "Explore topics" internal-link block (keywords + category links)

## Design
- Stats strip in hero, "New" badge (3 din tak), scroll-reveal animation,
  newsletter card in sidebar, focus rings, dark mode + mobile OK, reduced-motion respected
