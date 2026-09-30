# V8: Vote Contest (do image wala muqabla, kisi bhi topic par)

Cricket ki jagah ab koi bhi topic: politics, do dost, do gaane, kuch bhi. Har option ki apni image. Link WhatsApp/Facebook par share hota hai
aur preview mein dono ki photo + VS wali card nazar aati hai.

## Deploy ke qadam (is tarteeb se)
1. **Database (deploy se PEHLE):** `migration_v8.sql` Neon SQL Editor mein paste karke Run karein. Do tables: `polls`, `poll_votes`.
2. Purani prediction files hata dein (agar V7 push kar chuke hain):
   `git rm routes/predict.js views/predictions.ejs`  (na hon to skip)
3. `git add -A && git commit -m "V8 vote contest" && git push origin main`

Koi nayi npm package nahi (sharp pehle se hai).

## Istemal
- Admin: navbar mein 🗳️ Vote -> "New contest": title, dono ke naam, dono ki image upload, (optional) end time.
- Publish ke baad contest ka page khulta hai: neeche **WhatsApp / Facebook / Copy link** buttons.
- Reader: option dabata hai. Login nahi hai to login/signup ke baad vote khud lag jata hai. Ek account = ek vote, end tak badal sakta hai.
- Admin voting band/dobara shuru kar sakta hai ya contest delete kar sakta hai.

## Note
- Images Neon database mein save hoti hain (jaise post images), delete karne par bhi database mein rehti hain.
- Facebook/WhatsApp purani preview cache kar lete hain. Title/image badalni ho to naya contest banayein.
