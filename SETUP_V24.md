# V24: SEO mukammal (technical + schema + sitemap)

**Naya package: `compression`** (gzip, site tez). Deploy se pehle ek baar `npm install` chalayen (package.json aur package-lock.json update ho chuki hain). Migration koi nahi.

1. `npm install`
2. `git add . && git commit -m "V24 SEO" && git push`

## Kya naya hai
- **Har page ka apna title + description**: `/blog`, har category (`/blog?category=Cricket`), har tag, aur page 2, 3... Pehle sab ka title ek jaisa tha (duplicate = Google ke liye kamzor). `/blog` aur `/` ab alag titles rakhte hain.
- **Search results (`?q=`) noindex,follow**: patle pages Google mein nahi aate.
- **Error pages (404/403/500) khud noindex**; khali profile (na bio, na feed post) noindex; private group ka lock page aur group invite link noindex.
- **Sitemap bada**: ab categories, tags, public groups, vote contests, `/groups`, `/votes`, `/predictions` bhi hain; posts ki cover image bhi; home/blog ki `lastmod` sab se nayi post ki date.
- **robots.txt**: invite, manage, chat, editor, `/votes/*/go` wagera crawl se bahar.
- **Structured data**: `Organization` (logo + sameAs), `WebSite` (search link ab `/blog?q=`), blog/category/tag par `CollectionPage` + `ItemList` + breadcrumb, posts mein `inLanguage`, `timeRequired`, author link, publisher logo; profile par `ProfilePage`.
- **Meta tags**: `article:modified_time`, `article:section`, `article:tag`, `og:image:alt` (hamesha), `twitter:site`, `author`, Bing / Yandex verification, `preconnect` (CDN tez).
- **RSS behtar**: `atom:link self`, `language`, `lastBuildDate`, author, category, thumbnail, 30 items.
- **OpenSearch** (`/opensearch.xml`): browser ki address bar se seedha site search.
- **Speed**: gzip, `/blog/` -> `/blog` (301, duplicate URL nahi), halke security headers (nosniff, referrer, HSTS production mein).

## Nayi .env settings (sab optional)
| Variable | Kaam |
|---|---|
| `BING_SITE_VERIFICATION` | Bing Webmaster Tools ka meta tag ka `content` |
| `YANDEX_SITE_VERIFICATION` | Yandex ka `content` |
| `TWITTER_HANDLE` | bina `@` ke, `twitter:site` ke liye |
| `SOCIAL_LINKS` | comma se alag poore `https://` links (Facebook page, YouTube, Instagram...) |
| `FORCE_CANONICAL_HOST=1` | `SITE_URL` ke ilawa har host / http par 301 |

**FORCE_CANONICAL_HOST ehtiyat**: pehle `SITE_URL` bilkul sahi set karein (https + asli domain). Agar Railway ka health check purane `railway.app` host par chalta hai to 301 usay fail kar sakta hai; custom domain lagane ke baad hi on karein, aur Google login ka redirect URL bhi naye domain par ho.

## Aap ko khud karna hai (code se nahi hota)
1. Google Search Console: `/sitemap.xml` dobara submit karein (naye URLs shamil hue hain).
2. Bing Webmaster Tools mein site add karein (Search Console se import ka option hai) aur verification content upar wali env mein daalein.
3. Custom domain (.com): `railway.app` subdomain par authority banana bohat mushkil hai. Domain lagayein, `SITE_URL` badlein, phir `FORCE_CANONICAL_HOST=1`.
4. Har post mein: title 50-60 chars, excerpt 140-155 chars, cover image, 2-4 tags, aur kam az kam 500+ lafz. Bade topics ke liye asli `/blog` article, feed post sirf teaser.
5. Ek post doosri posts ko link kare (internal links), `[text](/posts/slug)` markdown se.
6. Search Console > Core Web Vitals report ek hafte baad dekhein (gzip + preconnect ka asar).

## Test kaise hua
Mock database ke saath `/blog` (filter ke saath aur bina), `?q=`, `/sitemap.xml`, `/rss.xml`, `/robots.txt`, `/opensearch.xml` render karke dekha: XML aur JSON-LD durust nikle, titles aur robots tags sahi. Asli Neon database par pehli baar deploy ke baad `/sitemap.xml` aur `/rss.xml` khol kar ek nazar zaroor dekh lein.
