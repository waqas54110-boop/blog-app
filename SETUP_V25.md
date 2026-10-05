# V25: Analytics mein Age / Gender / Country + repeat clicks

## Kya naya hai
- **Signup aur Edit profile** mein 3 optional fields: Birth year, Gender, Country (Google login walay members Settings > Edit profile se bhar sakte hain).
- **/analytics** mein naya "👥 Audience" section:
  - Total clicks, unique people, avg clicks per person, wapas aane walay (2+ clicks)
  - Age group ke hisaab se clicks (13-17, 18-24, 25-34, 35-44, 45-54, 55+, Unknown)
  - Gender doughnut chart
  - Country ke hisaab se clicks (flag ke saath)
  - "Ek banda kitni bar aaya" chart (1 / 2 / 3-5 / 6-10 / 11+ times)
  - Most active visitors table (naam, country, gender, age, posts, clicks, last seen)

## Deploy ke steps
1. **migration_v23.sql** ko Neon SQL Editor mein run karein (pehle, deploy se PEHLE). Dobara run karna safe hai.
2. `git add . && git commit -m "V25 audience analytics" && git push` (Railway khud deploy karega).
3. Admin se /analytics kholein. Naya data naye clicks ke saath bharna shuru hoga (purane visits "Unknown" rahenge).

## Zaroori baatein
- **Click** = post page ka visit (bots aur admin ginay nahi jate, pehle ki tarah).
- **Ek banda**: login wala member `u<id>` se pehchana jata hai (kisi bhi device par ek hi); guest browser cookie `pv` se.
- **Age/Gender**: sirf un members ki jinhon ne profile mein bhari; guests ka "Unknown".
- **Country**: guest ke liye hosting headers se (Cloudflare `CF-IPCountry`, Vercel, CloudFront). Railway ye header nahi deta, is liye guests ki country khali reh sakti hai. Fix: domain par Cloudflare (free) lagayein, ya `npm install geoip-lite` (code khud use kar lega). Members ki country unki profile se aati hai.
- Agar migration run karna bhool jayein to site chalti rahegi (visits purane tareeqe se ginay jayenge), bas Audience section khali rahega aur Edit profile page error dega jab tak migration na chale.
