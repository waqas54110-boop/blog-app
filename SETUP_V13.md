# V13: Public profile + Follow, Report/Moderation + Spam filter, Referral/Invite

| Feature | Kahan dikhta hai |
|---------|------------------|
| **Public profile** | `/u/username`: rank (Prediction League), points, votes, predictions, comments, badges, followers. Comments, leaderboards aur header menu ("My Profile") se link |
| **Follow** | Profile par (aur post ke author ke saath) **➕ Follow**. Followed user ka naya post ya contest aaye to in-app 🔔 notification + email (follower profile par email on/off kar sakta hai) |
| **Report** | Har comment par **Report** (post aur contest dono), contest page par **🚩 Report this contest** |
| **Moderation queue** | Admin: `/admin/moderation` (menu mein badge ke saath). Delete / Keep / Close contest |
| **Spam filter** | Comment save hone se pehle chalta hai. Words list admin isi page par badal sakta hai |
| **Invite link** | `/invite`: apna link `/r/CODE`, WhatsApp share, badges (3 / 10 / 25 dost), top inviters |
| **Giveaway bonus** | Contest ke Sponsor box mein **Invite bonus** checkbox: har counted dost = 1 extra entry (max 5) |

## Deploy ke qadam (is tarteeb se)
1. **Database (deploy se PEHLE):** `migration_v13.sql` Neon SQL Editor mein paste karke Run karein. (`migration_v9` aur `migration_v11` pehle chal chuki hon.) Dobara run karna safe hai.
2. `git add -A && git commit -m "V13 profile, follow, moderation, referral" && git push origin main`

Koi nayi npm package nahi. Koi naya environment variable zaroori nahi (optional: `REPORT_AUTOHIDE`).

**Zaroori:** migration deploy se pehle chalayein. Warna comments save nahi honge (naya `is_hidden` column chahiye).

## Follow + email (Gmail)
- Email wahi mailer bhejta hai jo reply notifications ke liye pehle se chal raha hai (Brevo / Mailjet / SMTP2GO / Resend / SMTP). Mailer set na ho to sirf in-app 🔔 jati hai.
- Email sirf **verified email** wale followers ko jati hai, aur har email ke neeche "email alerts band karne" ka link hota hai.
- Server har minute dekhta hai: kaun si post (schedule ki hui bhi, jab live ho) ya contest abhi followers ko nahi gayi. Har ek sirf **ek baar** jati hai. Purani posts/contests ko migration "sent" mark kar deti hai, deploy par purane content ki notifications nahi aayengi.
- Abhi sirf owner (admin) posts/contests banata hai, is liye practically readers owner ko follow karte hain. Code kisi bhi user ke liye kaam karta hai.
- Bohat zyada followers (sainkron) hon to emails ek ek karke jati hain (provider ki limit se bachne ke liye), is mein kuch minute lag sakte hain. In-app notification foran bantti hai.

## Report + moderation
- Ek user ek cheez ko ek hi baar report kar sakta hai, apna content report nahi kar sakta. Limit: 10 reports / 10 minute.
- **Auto-hide:** `REPORT_AUTOHIDE` (default 3) alag logon ki reports par comment public se chhup jata hai (comment likhne wale ko aur admin ko nazar aata hai). Admin **Keep** dabaye to wapas aa jata hai.
- Queue mein har cheez ek baar dikhti hai: kitni reports, wajah, kis ne ki, comment ka matn. Actions: **Delete** (comment), **Keep**, **Close contest** (contest ke liye).
- Admin ke menu / dashboard par red badge reports ki ginti dikhata hai.

## Spam filter
| Kya milta hai | Nateeja |
|---------------|---------|
| Spam word / jumla (list mein se) | **Block**: comment save nahi hota, user ko wajah dikhti hai |
| 3 ya zyada links | **Block** |
| Wahi comment 10 minute ke andar dobara | **Block** |
| Naye account (3 din se kam) ka link wala comment | **Hold**: hidden save + queue mein (Spam filter ka label) |
| Ek hi harf/lafz baar baar, ya poora CAPS | **Hold** |
- Admin ke comments par filter nahi chalta.
- Default list chhoti aur sirf saaf spam/scam ki hai (casino, "earn money online", "paisay kamao" waghera). `/admin/moderation` ke "Spam words" box mein apni list likh dein, ek line = ek lafz/jumla. Gaali ke alfaz bhi yahin daal sakte hain. Lafz poora match hota hai (list mein "cat" ho to "category" nahi pakri jati).
- False positive ka ilaaj: block hone par user ko "site owner se rabta karein" dikhta hai; hold wale comments aap queue se Keep kar sakte hain.

## Referral / invite
- Har user ko `/invite` par apna link milta hai (`/r/CODE`). Dost link kholta hai, 30 din ke liye code yaad rehta hai, signup (email ya Google) par bulane wale se jur jata hai. Signup page par "X invited you" dikhta hai, aur bulane wale ko notification jati hai.
- **Referral kab ginta hai:** dost ki email **verified** ho **aur** us ne kam az kam ek kaam kiya ho (vote, prediction ya comment). Is se fake accounts se entries bharna mushkil hota hai.
- **Badges:** 3 dost = 🤝 Recruiter, 10 = 🚀 Super Recruiter, 25 = 👑 Ambassador. Ye profile par dikhte hain.
- **Giveaway:** contest ke Sponsor box mein **Invite bonus** lagayein. Draw ke waqt har eligible voter ke liye 1 entry + har counted dost ke liye 1 extra (max 5 extra). Default band hai, purane giveaways pehle jaise barabar chance dete hain. Draw ke baad "drawn from N" mein N log hi ginti hain (entries nahi).

## Badges (profile)
Alag table nahi: har baar asli numbers se banti hain. 🗳️ Voter / Super Voter (10) / Vote Machine (50), 💬 Regular (5 comments) / Chatterbox (25), 🎯 Predictor, 🔮 Oracle (10 sahi), 🏅 Top 3 Predictor, 🎁 Giveaway Winner, referral badges, 🛡️ Blog Owner.

## Privacy: dhyan rakhein
- Profile **public** hai (login ke bagair bhi khulta hai): username, join date, votes (kis contest mein kis ko vote), comments ki ginti, scored predictions.
- Jis match par predictions abhi khuli hain us par user ki pick profile par **nahi** dikhti (warna doosre copy kar lete). Match shuru hone ke baad dikhti hai.
- Email kabhi public nahi hoti.
