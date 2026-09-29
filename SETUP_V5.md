# V5: traffic features (setup guide)

Naye features: Google structured data, IndexNow, table of contents + progress bar,
auto share-card image, push notifications (+ install-able PWA).

## 1. Deploy karne ke 3 qadam (is tarteeb se)

1. **Do nayi packages** (`sharp`, `web-push`) ke liye laptop par:
   ```
   npm install
   ```
   Phir `package.json` **aur `package-lock.json` dono** commit karein. (Railway `npm ci` chalata hai;
   lock file update na ho to build fail hoga.)
2. **Database (ek baar, deploy se PEHLE):** `migration_v5.sql` ko Neon SQL Editor mein paste karke Run karein.
   Dobara run karna safe hai. Ye `posts` mein 3 columns aur 2 nayi tables (`push_subscriptions`, `app_settings`) banata hai.
   Purani posts ko "already sent" mark kar deta hai, is liye deploy par purani posts ki notification nahi jayegi.
3. `git add -A && git commit -m "V5 traffic features" && git push` (Railway khud deploy kar dega).

`SITE_URL` Railway ke Variables mein poora `https://...` URL hona zaroori hai (IndexNow aur push ke liye).

## 2. Kya naya hai aur check kaise karein

| Feature | Kya karta hai | Check kaise karein |
|---|---|---|
| JSON-LD | Har post par Article + Breadcrumb, home par WebSite search data | Post ka URL https://search.google.com/test/rich-results par daalein |
| IndexNow | Post live hote hi (ya schedule time par) Bing/Yandex ko khud khabar. Live post edit karne par bhi | Railway Logs mein `[indexnow] post N: bhej di (202)`. Key file: `https://aap-ki-site/<key>.txt` (key ka link start par logs mein print hota hai) |
| Table of contents | Post mein 3 ya zyada `##` / `###` headings hon to "In this post" list | Editor mein `## Heading` likhein |
| Progress bar | Post padhte waqt upar patli line | Post kholein aur scroll karein |
| Share card | Cover image na ho to title wali 1200x630 image | `https://aap-ki-site/og/<post-slug>.png` kholein. Facebook Sharing Debugger se bhi dekh sakte hain |
| Push | Footer mein "🔔 Notify me on this device" button. Nayi post live hote hi notification | Button dabayein, Allow karein, phir ek post publish karein |

## 3. Google ke liye (5 minute, ek baar)
Google IndexNow use nahi karta. https://search.google.com/search-console par site add karein aur
`https://aap-ki-site/sitemap.xml` submit karein. Bas.

## 4. Kuch cheezein jo jaan lein
- **Share card:** WhatsApp/Facebook purani shared links ka preview yaad rakhte hain, isliye jo link pehle share ho chuka
  uska preview nahi badlega. Nayi posts par card aayega. Cover hone par bhi card chahiye to `OG_CARD_ALWAYS=true`.
  Font (`fonts/DejaVuSans-Bold.ttf`) saath bundle hai, isliye server par fonts na hon tab bhi text dikhega.
  Ye font Urdu (nastaliq) script ke liye nahi, English/Roman Urdu titles ke liye hai.
- **Push:** iPhone par notification sirf tab jab site ko Safari se "Add to Home Screen" kiya ho (Apple ki shart);
  tab hi button nazar aata hai. Android/Chrome/Desktop par seedha chalta hai.
  Push keys pehli baar khud bani aur `app_settings` table mein hain. Wo table/rows delete na karein,
  warna sab subscribers ko dobara "Notify me" dabana paray ga.
- **Subscriber count:** `SELECT COUNT(*) FROM push_subscriptions;` (Neon SQL Editor mein)
- Agar `sharp` ya `web-push` install na ho to site normal chalti hai, sirf wo feature band rehta hai (logs mein likha aata hai).
- Push sirf asli browser push services (Google, Mozilla, Apple, Microsoft) ke addresses qubool karta hai (security).
