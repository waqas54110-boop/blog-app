# V45 - Daily Rates (dollar, gold, silver, petrol, namaz timings)  [English pages, auto-update]

Ye zip CUMULATIVE hai: is mein V43 (Facebook wall) + V43b + V44 (Facebook hook) + V45 sab ki files hain.
Ek hi dafa copy karo, ek hi dafa push karo.

## Pehle SQL chalao (Neon SQL Editor -> paste -> Run), is tarteeb se
1. migration_v44.sql   (agar pehle nahi chalai)
2. migration_v45.sql   (rates_history table)
Jab tak SQL nahi chalta, site normal chalti rahegi; /rates par "being set up" ka message aayega.

## Naye pages (sab English, sitemap mein khud shamil)
- /rates                       hub: dollar, gold, silver, petrol, namaz ek nazar mein
- /rates/dollar-rate-today     USD, SAR, AED, GBP, EUR to PKR + converter + pichle 14 din
- /rates/gold-rate-today       24K/22K/21K/18K (tola, 10g, gram) + silver + pichle 14 din
- /rates/petrol-price-today    petrol, diesel, kerosene, LDO + price history
- /rates/prayer-times/lahore   10 shehar (karachi, islamabad, peshawar, quetta ...), "Next prayer in X min"
- /admin/rates                 (sirf admin) petrol/diesel/gold adjustment daalo, "Refresh now"
Navbar mein "💱 Rates" aur menu mein "Today's Rates" link lag gaya hai.

## Kya khud update hota hai
- Dollar + SAR/AED/GBP/EUR: har 30 minute (open.er-api.com, fallback jsDelivr currency-api)
- Gold + Silver (international price x USD/PKR): har 30 minute (gold-api.com, fallback jsDelivr)
- Namaz timings: roz ek dafa har shehar ka (aladhan.com, Karachi University method, Hanafi Asr)
- Har cheez ka roz ka record rates_history mein jata hai -> "Last 14 days" tables khud banti hain
- Koi API band ho to purani qeemat dikhti rehti hai (khali page nahi), aur log mein error aata hai
- Ye sab free APIs hain, koi key nahi chahiye

## Kya haath se hota hai (2 minute, 15 din mein ek dafa)
Petrol/diesel ki qeemat government ka elaan hai, is liye /admin/rates par daalni hoti hai:
1. /admin/rates kholo, petrol/diesel ki nayi qeemat likho, "Effective from" ki date, Save.
2. Pehle wali qeemat history mein khud chali jati hai aur "change" (up/down) khud nikalta hai.

## Gold ko apne sarafa rate se milana
Gold = international price x dollar rate. Local sarafa rate usse thora alag hota hai.
/admin/rates > "Gold adjustment" mein farq daalo (jaise 6000 ya -3000, Rs per tola).
Ek dafa milaoge to baad mein khud sahi rahega.

## Deploy
    cd ~/Pictures/first_backup
    cp -r ~/Pictures/first/{app.js,config.js,.env.example,lib,routes,views,migration_v44.sql,migration_v45.sql,SETUP_V4*.md} .
    git add . && git commit -m "V43-V45: fb wall, fb hook, daily rates" && git push

## Deploy ke baad (traffic ke liye zaroori)
1. Google Search Console > Sitemaps > sitemap.xml dobara "Submit" karo (nayi /rates pages shamil hain).
2. URL Inspection mein /rates, /rates/dollar-rate-today, /rates/gold-rate-today ke liye "Request indexing".
3. Facebook par rate page share karo: card khud banta hai (jaise "24K Gold: Rs 2,85,777 per tola").
4. Roz ek dafa 1 minute: apni Facebook groups mein /rates/... ka link daalo (Group Poster use karo).

## Zaroori baatein
- Dollar rate "mid-market" hai; open-market dealers ka rate thora alag hota hai (page par likha hai).
- Gold/silver ka hisaab international rate se hai; jewellers ka rate aur making charges alag ho sakte hain (page par likha hai).
- Kisi page par aisi cheez mat likho jo sach na ho (jaise purani qeemat ko "aaj ki" kehna): log wapas nahi aate.
