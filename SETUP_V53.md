# V53: Analytics mein User-Agent, Referrer, Requests per IP

## Kya naya hai
Admin `/analytics` -> "Recent visitors" table (aur shop ke `/seller/analytics` wali table) mein ab:
- **Requests (is IP ki)**: us IP ne is period mein kitni baar aur kitne pages / products khole.
- **Browser / Device**: User-Agent se chhota label (jaise "Chrome - Android", "TikTok app"). Mouse upar le jao to poora User-Agent.
- **Referrer**: visitor kis site se aaya (host). Pehle se save hota tha, ab table mein dikhta hai.

Naya card **"Busiest IPs"** (sirf admin analytics): top 10 IP, requests, pages, aur us IP par kitni alag devices (cookies).

## Setup
1. `migration_v53.sql` Neon SQL Editor mein chalayen (sirf `user_agent` column add hota hai).
2. Files copy karo, git push karo. Koi naya package nahi.
3. Naye visits se User-Agent aana shuru hoga. Purane visits mein "-" dikhega.
   Migration na chale to bhi analytics chalta rehta hai, bas Browser / Device khali rehta hai.

## Dhyan rakhein
- Pakistan ke mobile networks (Jazz, Zong, Telenor...) mein bohat saare log ek hi IP share karte hain (CGNAT). Isliye ek IP = ek insaan nahi.
- Location "-" aane ka matlab hai server ko country/city nahi mili. Render par Cloudflare headers nahi hote, to `npm i geoip-lite` chalao (code pehle se use karta hai, bas install chahiye).

## Files
Naye: `migration_v53.sql`, `SETUP_V53.md`
Badle: `lib/analytics.js`, `lib/shop.js`, `routes/engage.js`, `routes/seller.js`, `views/analytics.ejs`, `views/seller-analytics.ejs`
