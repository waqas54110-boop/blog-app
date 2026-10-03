# V23: SEO (Google ranking ke liye)

Naya package koi nahi, migration koi nahi. Bas `git push` se deploy karo.

## Kya naya hai
- **/feed/ID page**: title ab post ka headline hai (username wala kata hua title nahi), saaf meta description (~155 chars), `SocialMediaPosting` + `BreadcrumbList` structured data, ek `<h1>` (screen reader / Google ke liye), image ka alt text post ke matn se, `<time datetime>`.
- **robots meta**: har page par `index,follow,max-image-preview:large`. Hidden (review mein) aur group ki posts par `noindex`.
- **sitemap.xml**: ab public feed posts (`/feed/ID`) aur unki images bhi hain, `lastmod` sahi hai (post edit / naya comment).
- **robots.txt**: login, messages, settings, dashboard wagera crawl se bahar.
- **IndexNow**: naya public feed post banate hi Bing / Yandex ko ping.

## Aap ko khud karna hai (code se nahi hota)
1. Railway Variables mein `SITE_URL=https://aap-ka-domain` zaroor set ho (sitemap, canonical aur IndexNow isi se chalte hain).
2. Google Search Console mein site add karo, `/sitemap.xml` submit karo.
3. Naye post ke baad Search Console > URL Inspection > Request indexing.
4. **Acha title paane ka tareeqa**: feed post ki **pehli line** chhota headline rakho (70 chars tak), jaise
   `India vs Pakistan Asian Games 2026 Cricket Final: Time, Venue, Squads`, phir nayi line se baqi detail.
5. Bade topics (jaise cricket final) ke liye `/blog` mein 500+ words ka asli article likho; feed post usi ka chhota link/teaser ho.
6. Custom domain (`.com`) lo; `railway.app` subdomain par authority banana bohat mushkil hai.
