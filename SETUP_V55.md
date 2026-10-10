# V55: Analytics upgrade 📊 (Device + Browser, Visitor journey, Bots tab, ISP / VPN)

## Kya naya hai
1. **Device + Browser** (`/analytics` > "Device & Browser"): mobile / desktop / tablet, browser (Chrome, Safari, Samsung Internet...),
   OS, phone brand (Samsung, Infinix, Tecno, Vivo, Oppo, Xiaomi, iPhone...) aur kitne log Facebook / Instagram / TikTok app ke andar se aaye.
2. **Visitor journey**: "Most active visitors" aur "Recent visitors" ki har row mein **Journey →** link.
   Us visitor ne kab, kahan se aa kar, kaun kaun si post / product dekhi, kitni sessions, aur order kiya ya nahi.
   (`/analytics/visitor/<id>`)
3. **Bots alag tab** (`/analytics?tab=bots`): Googlebot, Facebook preview, WhatsApp / Telegram preview, SEO / AI crawlers, scripts.
   Ye People ke numbers mein kabhi shamil nahi hote. Daily graph, top bots, bots ne kaun se pages dekhe, recent hits.
   Facebook preview ka count batata hai ke koi link Facebook / Messenger mein share ho raha hai.
4. **ISP / VPN** (`/analytics` > "ISP / VPN"): kis company ke internet se aaye (PTCL, Jazz, Zong, Nayatel, StormFiber...),
   VPN / Proxy / Datacenter ka percent, mobile data ka percent. Recent visitors table mein har IP ke saath ISP aur VPN tag.

## Setup (3 kaam)
1. `migration_v55.sql` Neon SQL Editor mein poora paste karke chalayen (dobara chalane se kuch nahi bigarta).
2. Files copy karo, `git push` karo. Koi naya package nahi.
3. Optional `.env` (Railway Variables mein):
   - `IPAPI_KEY=...` : ISP / VPN lookup ke liye ipapi.is ki key. Na ho to free limit par chalta hai (kam traffic ke liye theek).
   - `IPINFO_DAILY_MAX=800` : ek din mein kitne IPs ka lookup ho (default 800).
   - `IPINFO_PROVIDER=off` : ISP / VPN lookup band karna ho to.

## Zaroori baatein (sach sach)
- **Purane visits** mein device / browser nahi hota (pehle store nahi hota tha). Ye sirf migration ke **baad ke** visits se bharega.
  Purane IPs ka ISP / VPN dheere dheere background mein bhar jata hai (har baar `/analytics` kholne par ~40 IPs).
- ISP / VPN ek **external service** (ipapi.is) se aata hai. Pehli baar page kholne par "checking..." dikh sakta hai, kuch minute baad refresh karein.
  Har IP ek hi baar lookup hota hai (database mein cache), isliye site slow nahi hoti.
- **VPN flag andaza hai**, 100% pakka nahi. Mobile data (Jazz / Zong / Telenor / Ufone) par bohat se log ek hi IP share karte hain,
  isliye sirf IP se ek banda pehchanna sahi nahi.
- **Bots**: pehchan User-Agent se hoti hai. Koi bhi script khud ko "Googlebot" keh sakti hai.
  Ab bina User-Agent wali requests aur kuch aur crawlers (Bytespider, Ahrefs, Semrush, GPTBot...) bhi bot gine jate hain,
  isliye People ke numbers pehle se thore saaf (kam, lekin zyada sahi) ho sakte hain. Pay-per-click ads mein bhi ye bots nahi ginay jayenge.
- Bot rows 90 din baad khud delete ho jati hain.
- Guest ka journey browser cookie par chalta hai: cookie saaf ho ya naya browser, to naya visitor ban jata hai.

## Files
Naye: `migration_v55.sql`, `SETUP_V55.md`, `lib/ua.js`, `lib/ipinfo.js`, `views/analytics-bots.ejs`, `views/analytics-visitor.ejs`, `views/partials/analytics-style.ejs`
Badle: `lib/analytics.js`, `lib/shop.js`, `routes/engage.js`, `routes/posts.js`, `views/analytics.ejs`
(`views/analytics.ejs` ki CSS ab `partials/analytics-style.ejs` mein hai, dono file saath copy karni hain.)

## ⚠️ Agar tum ne V52 ke baad `lib/shop.js` ya `routes/posts.js` badli hai (V53 / V54 wagera)
Un do files ko **poori copy mat karo** (naya kaam mit jayega). Baaqi 10 files seedhi copy kar sakte ho.
In do files mein sirf chhote changes hain, `PATCH_V55_shop_posts.diff` mein hain:
- `routes/posts.js`: `logBot` import + post par bot aaye to `logBot(req)` (2 jagah, 4 lines).
- `lib/shop.js`: `logBot`, `parseUA`, `ipinfo` import + `trackProductVisit` mein bot log aur device columns wali insert.
`routes/engage.js` aur `views/analytics.ejs` bhi agar V52 ke baad badli hon to mujhe batao, main merge kar dunga.
