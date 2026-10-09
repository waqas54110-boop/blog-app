# V52: Bina signup wale visitor ko message (notification) 🔔

## Kya hota hai
Product page par jo visitor login nahi hai, 7 second baad neeche ek chhota card aata hai:
"Is product ki khabar chahiye?" -> [Haan, khabar do] / [Account banao]
- "Haan" dabane par browser notification ki ijazat maangta hai. Ijazat milte hi usi waqt ek confirm notification jati hai.
- 2 ghante baad (agar product stock mein ho) us device par push jata hai: "Aap ne ye dekha tha, abhi stock mein hai..." (link ke saath). 24 ghante mein ek se zyada nahi.
- Signup zaroori nahi. Jin browsers mein push nahi chalta (jaise iPhone ka normal Safari), wahan card sirf "Account banao" dikhata hai.
- Card band karne par 3 din dobara nahi aata.

Signup wall (pehla hissa free, baqi ke liye signup) ab DEFAULT BAND hai. Chalu karni ho to `.env` mein `SHOP_WALL=1`.

## Setup
1. `migration_v52.sql` Neon SQL Editor mein chalayen.
2. Files copy karo, git push karo. Koi naya package nahi (web-push pehle se hai).
3. Optional `.env`: `REMINDER_AFTER_HOURS=2` (kitne ghante baad push).

## Zaroori baat
Bina ijazat ke kisi guest ko message nahi ja sakta (email/phone hota hi nahi). Isi liye notification ki ijazat maangte hain.

## Files
Naye: `migration_v52.sql`, `lib/shopwall.js`, `SETUP_V52.md`
Badle: `config.js`, `lib/push.js`, `lib/reminders.js`, `routes/growth.js`, `routes/shop.js`, `routes/auth.js`, `views/shop-product.ejs`, `views/login.ejs`, `views/signup.ejs`
