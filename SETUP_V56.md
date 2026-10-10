# V56: Shop ke 6 naye features 🛍️

## Kya naya hai
1. **Variants (rang / size / qisam)**: Seller product edit page par "🎨 Variants" mein rows daalta hai (Rang, Size, Qisam, optional alag price, stock). Har variant ka apna stock hai. Customer ko pehle option chunna hota hai; sold out option disabled dikhta hai. Variant wale product ka upar wala Stock un ka jama ban jata hai (khud sync).
2. **Coupons**: Seller menu mein "🏷️ Coupons". Jaise `TIKTOK10` = sirf TikTok se aane walon ko 10% chhoot. Percent ya seedhi raqam, kam az kam order, kitni dafa chale, aakhri tareekh. Har coupon ke saamne kitne orders, kitni sale, kitni chhoot dikhti hai. Coupon link se bhi lag sakta hai: `/tp/PRODUCT_ID?coupon=TIKTOK10` ya product / cart link ke aakhir mein `?coupon=TIKTOK10`.
3. **Cart**: Product page par "🛒 Cart mein daalo". `/cart` par quantity, hatao, coupon, delivery ki maloomat, aur "✨ Ye bhi khareedein" suggestions. Alag alag shops ki cheezein hon to har shop ka alag order banta hai (alag delivery). Sab kuch ek transaction mein: koi cheez sold out ho to kuch bhi order nahi hota.
4. **Order ke baad WhatsApp message khud**: Order aate hi customer ko "order mil gaya, 1 se 2 din mein pahunche ga"; "Bhej diya" ya tracking number likhne par tracking wala message. Har order ka har message sirf ek baar. Seller ke order card par dikhta hai ke message gaya ya nahi; nahi gaya to tayyar wa.me button se haath se bhej sakta hai.
5. **Courier + tracking number**: Seller order card mein "📦 Courier aur tracking number likhein" (TCS, Leopards, M&P, Trax, PostEx, BlueEx, Call Courier, Pakistan Post, doosra). Order "Bhej diya" ho jata hai aur customer ke order page par "🔎 Track karein" aata hai.
6. **Social proof (sirf asli ginti)**: Product page par "👀 Aaj N logon ne dekha" (aaj ke alag visitors; apni shop, admin aur bots ke visits nahi ginte) aur "🛒 N orders ho chuke" (wapas aaye orders nahi ginte). Ginti `PROOF_MIN_VIEWS` (default 3) / `PROOF_MIN_ORDERS` (default 1) se kam ho to line dikhayi hi nahi jati. Koi jhoota number nahi.

## Bonus (V56 ke saath, naya database table nahi)
7. **Orders ki CSV / Excel export**: Seller > Orders par "⬇️ Excel / CSV download" (filter ke mutabiq, 5000 tak orders). Excel mein Urdu / Roman text theek khulta hai.
8. **Packing slip / shipping label**: Har order card par "🖨️ Slip": naam, phone, pata, saman, courier / tracking, aur COD ho to "COD: Rs ... wasool karein". Print button ke saath.
9. **Stock kam hone ki khabar**: Order se kisi product (ya variant) ka stock 3 ya us se kam ho jaye to seller ko notification (har dafa nahi, sirf jab 3 se neeche utray).
10. **Mera order dhoondo** (`/track`): customer order number + phone likh kar apna order page khol sakta hai (account ke baghair). Galat andazon se bachne ke liye rate limit laga hai.

## Setup
1. `migration_v56.sql` Neon SQL Editor mein chalayen (server start par khud bhi chal jati hai; dobara chalane se nuqsan nahi). Purane orders khud `order_items` mein aa jate hain.
2. Files copy karo, git push karo. Koi naya package nahi.
3. `.env` mein kuch zaroori nahi. Cart, coupons, variants, courier aur social proof bina kisi setting ke chalte hain.

## WhatsApp auto message (optional, Meta WhatsApp Cloud API)
WhatsApp par kisi ko pehla message sirf Meta se manzoor-shuda **template** ke zariye ja sakta hai. Isliye:
1. Meta Business mein WhatsApp Cloud API ka app banayen, **permanent token** aur **Phone number ID** len.
2. `.env`: `WHATSAPP_TOKEN=...` aur `WHATSAPP_PHONE_ID=...`
3. Meta mein 2 templates banayen (category: Utility, language jo `WHATSAPP_TEMPLATE_LANG` mein ho, default `en`). Variables ki tarteeb bilkul yehi rakhein:

   **order_received** (`WHATSAPP_TEMPLATE_PLACED`):
   ```
   Assalam o Alaikum {{1}}! {{2}} par aap ka order #{{3}} mil gaya hai. Kul raqam Rs {{4}}. Ye {{5}} mein pahunch jaye ga. Order ki halat: {{6}}
   ```
   {{1}} naam, {{2}} shop, {{3}} order number, {{4}} kul raqam, {{5}} kitne din (`ORDER_ETA_TEXT`), {{6}} order page link.

   **order_dispatched** (`WHATSAPP_TEMPLATE_DISPATCHED`):
   ```
   Assalam o Alaikum {{1}}! {{2}}: aap ka order #{{3}} bhej diya gaya hai. Courier: {{4}}, tracking number: {{5}}. Order ki halat: {{6}}
   ```
   {{1}} naam, {{2}} shop, {{3}} order number, {{4}} courier, {{5}} tracking number, {{6}} link.
4. Templates manzoor hone ke baad auto message chal parta hai. Setting na ho ya fail ho to order phir bhi ban jata hai; seller ke card par "💬 Tayyar message haath se bhejo" button aa jata hai.
5. `.env` mein `SITE_URL` zaroor set hona chahiye taake link poora jaye.

## Courier tracking links (honest note)
TCS aur Leopards ke **official tracking pages** par bheja jata hai; "number ke saath seedha link" ka koi pakka official pattern confirm nahi hua, is liye "Track karein" dabane par tracking number khud copy ho jata hai (page par paste karna hota hai). Agar kisi courier ka seedha link aap ke paas ho to `.env` mein `COURIER_TRACK_URLS` likh dein (misal `.env.example` mein).

## Files
Naye: `migration_v56.sql`, `lib/cart.js`, `lib/couriers.js`, `lib/whatsapp.js`, `routes/cart.js`, `views/shop-cart.ejs`, `views/shop-cart-done.ejs`, `views/seller-coupons.ejs`, `views/seller-slip.ejs`, `views/shop-track.ejs`, `SETUP_V56.md`
Badle: `app.js`, `config.js`, `.env.example`, `lib/shop.js`, `lib/reminders.js`, `routes/shop.js`, `routes/seller.js`, `views/shop-product.ejs`, `views/shop-order.ejs`, `views/seller-orders.ejs`, `views/seller-products.ejs`, `views/seller-product-form.ejs`, `views/partials/shop-style.ejs`, `views/partials/seller-nav.ejs`, `views/partials/header.ejs`
