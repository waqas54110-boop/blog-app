# V51: Product dekh kar order na karne walon ko message 🔔

## Kya naya hai
1. **Members (login wale):** product dekha aur 2 ghante tak order nahi kiya, to unhein notification jati hai:
   "Aap ne X dekha tha. Abhi stock mein hai..." (link ke saath, source = `reminder`).
   - Har member ko 24 ghante mein sirf 1 reminder, aur sirf us product ka jo sold out / band na ho.
   - Order kar diya ho, ya apni hi shop ho, to nahi jata.
2. **Guests (bina signup):** product page par "Account banayein" ka card dikhta hai (order ke liye account zaroori nahi).

## Setup
1. `migration_v51.sql` chalayen.
2. Deploy. Koi naya package nahi.
3. Optional `.env`: `REMINDER_AFTER_HOURS=2` (kitne ghante baad), `REMINDER_EMAIL=1` (notification ke saath email bhi; default band).

## Zaroori baat
Guest ko seedha message nahi ja sakta: IP se kisi ko email / SMS / WhatsApp nahi bheja ja sakta, aur guest ka koi contact hota hi nahi.
Isi liye guest ko signup (ya order ke waqt phone number) tak laana zaroori hai; uske baad wo is reminder ke daira mein aa jata hai.

## Files
Naye: `lib/reminders.js`, `migration_v51.sql`, `SETUP_V51.md`
Badli: `app.js`, `views/shop-product.ejs`
