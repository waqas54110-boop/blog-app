# V50: Visit ke saath IP address + shehar 🌍

## Kya naya hai
Jab bhi koi **blog post** ya **shop product** dekhta hai, ab visit ke saath ye bhi save hota hai:
- **IP address**
- **Shehar** (agar hosting header ya `geoip-lite` se mile)
- **Country** (shop visits mein pehle nahi thi, ab hai) aur **member** (login ho to)

Dikhta kahan hai:
- **Blog analytics** (`/analytics`) > Audience > **Recent visitors** (poora IP, sirf admin ko)
- **Shop analytics** (`/seller/analytics`) > **Recent visitors**
  - Admin ko poora IP, seller ko masked (`39.45.12.xxx`)

## Setup
1. **SQL chalayen** (Neon SQL editor): `migration_v50.sql`
2. Deploy (git push).
3. Naye visits se IP aana shuru hoga. Purane visits ka IP nahi hota (tab save nahi hota tha).

## Shehar ke liye (optional)
Cloudflare ya Vercel ke peeche ho to shehar khud aata hai. Render par shehar chahiye to:
`npm install geoip-lite` (country bhi behtar ho jati hai). Na karein to sirf IP + country.

## Files
Naya: `migration_v50.sql`, `SETUP_V50.md`
Badli: `lib/demographics.js`, `lib/analytics.js`, `lib/shop.js`, `routes/seller.js`, `routes/engage.js`, `views/seller-analytics.ejs`, `views/analytics.ejs`

## Dhyan
- Migration se pehle deploy karein to bhi site nahi rukti: purani tarah visit ginti hai, bas IP nahi aata.
- IP personal data hota hai: privacy policy mein likh dein ke analytics ke liye IP save hota hai.
- Vote contests mein abhi visits ka table hi nahi hai, is liye wahan IP nahi lagaya.
