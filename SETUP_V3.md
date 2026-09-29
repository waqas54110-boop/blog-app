# Naye features: setup guide

## 1. Install + database
```
npm install
```
Phir `migration_v3.sql` ko apni database par **ek baar** run karein (Neon: SQL Editor mein paste karke Run;
local: `psql -d blog_db -f migration_v3.sql`). Dobara run karna bhi safe hai.
Purani posts publish hi rahengi aur un par newsletter dobara nahi jayegi.

## 2. .env / Render environment
`.env.example` dekhein. Zaroori: `SITE_URL`, `COMMUNITY_WHATSAPP_URL`, `COMMUNITY_FACEBOOK_URL`.
Email ke liye `SMTP_*` (Brevo ka free SMTP kaafi hai). SMTP set na ho to sirf email band hoti hai, baaqi sab chalta hai.

## 3. Kya kya naya hai
| Feature | Kahan |
|---|---|
| Group banner (WhatsApp / Facebook / Channel) | har post ke neeche, `views/partials/group-banner.ejs` |
| OG image + Twitter card | `views/partials/header.ejs` (post ki `cover_url` use hoti hai) |
| UTM tracking + visits | `lib/analytics.js`, table `post_visits` |
| Analytics dashboard | `/analytics` (admin), Chart.js |
| "Copy WhatsApp / FB msg" | `/dashboard` mein har post ke saath |
| Full-text search | home page search bar, `posts.search_vector` (GIN index) |
| Related posts (tags + category) | post ke neeche |
| Auto newsletter | `lib/newsletter.js` (har minute check), unsubscribe link `/unsubscribe/:token` |
| Comment replies + notifications | post page, `/notifications`, header mein 🔔 |
| Draft + scheduled posts | editor mein "Publishing" box |
| Rate limiting | `app.js` (login 15/15min, comments 10/5min, subscribe 6/ghanta) |
| CSRF protection | `lib/csrf.js`, har form mein hidden `_csrf` |

## 4. WhatsApp / Facebook preview test
Deploy ke baad post ka link Facebook ke **Sharing Debugger** (developers.facebook.com/tools/debug) mein
daal kar "Scrape Again" karein, aur WhatsApp par khud ko bhej kar dekhein ke image + title aa raha hai.
WhatsApp/Facebook purana preview cache kar lete hain.

## 5. Zaroori baatein
- Render par sirf ek instance chalayein (newsletter scheduler har instance par chalta hai).
- Analytics mein group ka sahi traffic tab dikhta hai jab links `?utm_source=whatsapp` ke saath share hon
  (share buttons aur dashboard ke "Copy msg" buttons yeh khud lagate hain).
- `.env` kabhi zip/GitHub mein share na karein.
