# V11: Sponsored contest + giveaway, homepage par live contest, Telegram auto-post

| Feature | Kahan dikhta hai |
|---------|------------------|
| **Sponsored contest** | Contest page par "Sponsored by [logo] Naam" (click par sponsor ki site, har click ginta jata hai), 🎁 prize, aur /votes list mein 🎁 badge |
| **Giveaway** | Contest khatam hone par admin "🎲 Pick a random winner" dabata hai. Winner ko notification + email jati hai, contest page par winner ka naam dikhta hai |
| **Sponsor report** | Contest page ke admin box mein "📊 Sponsor report": kitne log pahunche, kitne ne vote diya, kahan se aaye (WhatsApp/Facebook...), share, sponsor link clicks, roz ke votes. Print karke PDF bana lein ya "Copy WhatsApp summary" |
| **Homepage live contest** | Homepage ke upar "🔥 Live now" card: wahin vote karein, countdown aur live percentage. Pin kiya hua contest pehle, warna wo jis par pichhle 3 din mein sab se zyada votes aaye |
| **Telegram auto-post** | Naya contest banne par channel mein photo + "Vote now" button khud post hota hai, contest khatam hone par result, aur giveaway winner ka elaan |

## Deploy ke qadam (is tarteeb se)
1. **Database (deploy se PEHLE):** `migration_v11.sql` Neon SQL Editor mein paste karke Run karein. (`migration_v9.sql` aur `migration_v10.sql` pehle chal chuki hon.) Dobara run karna safe hai.
2. **Telegram chahiye to** (neeche dekhein) Render ke Environment mein `TELEGRAM_BOT_TOKEN` aur `TELEGRAM_CHAT_ID` daalein. `SITE_URL` bhi set hona zaroori hai. Telegram nahi chahiye to ye step chhor dein, baaqi sab chalta hai.
3. `git add -A && git commit -m "V11 sponsor, giveaway, home contest, telegram" && git push origin main`

Koi nayi npm package nahi.

## Telegram kaise jorein
1. Telegram mein **@BotFather** kholein, `/newbot` bhejein, naam aur username chunein. Wo aap ko **token** dega (`123456:ABC...`). Ye kisi ko na dikhayein.
2. Apna **channel** banayein (ya purana chunein). Channel ki Settings -> Administrators -> Add Administrator -> apna bot chunein, aur **"Post messages"** ki ijazat dein.
3. `TELEGRAM_CHAT_ID` mein channel ka username likhein, jaise `@mychannel` (public channel). Private channel ho to uski numeric id (`-100...`) chahiye hoti hai.
4. Render mein dono values daal kar deploy karein, phir **/votes** page par admin ko "✈️ Test Telegram" button nazar aayega. Dabayein, channel mein test message aana chahiye.

Kab post hota hai: server har minute dekhta hai. Naya contest (pichhle 2 din ka) -> "naya contest" post. Contest khatam (waqt poora, ya aap ne band kiya, ya knockout ka champion) -> "result" post (agar kisi ne vote hi nahi diya to result nahi jata). Har contest ki har post sirf ek baar jati hai.

## Sponsor aur giveaway kaise chalayein
**Naya contest:** "Sponsor, prize & giveaway (optional)" wala box kholein: sponsor ka naam, link, logo, prize likhein. "Who can win" mein chunein: har verified voter, ya sirf wo jinhon ne jeetne wale ko vote diya. "Pin on homepage" lagayein to ye homepage par pehle dikhega.

**Purane contest par:** contest page ke neeche (admin ko) "Sponsor, prize & giveaway" box hai, wahan se bhi lag jata hai.

**Draw:** contest band/khatam hone ke baad "🎲 Pick a random winner". Eligible sirf **verified email** wale voters hain (admin shamil nahi). Draw asli random (`crypto.randomInt`) se hota hai, aur kitne log eligible thay wo save hota hai. Winner na mile to "Redraw" dabayein: pehla winner nikal jata hai aur dobara nahi jeet sakta. Redraw kitni dafa hua, wo report mein likha rehta hai (shaffafiyat ke liye). Winner ki email sirf admin ko dikhti hai, taake aap us se rabta karein.

**Report:** contest page -> "📊 Sponsor report" -> "Print / Save as PDF". Admin ke apne visits aur bots ginay nahi jate.

## Zaroori baatein
- Render ka free plan jab server ko "sula" deta hai to Telegram wali minute-minute ki jaanch bhi ruk jati hai. Post ke liye site ka jaga hona zaroori hai (koi aaye ya uptime ping), warna post thori der se jayegi.
- Telegram contest ki photo `SITE_URL/og/vote/ID.png` se uthata hai, is liye site public honi chahiye. Photo na chale to sirf text ja jata hai.
- Giveaway ke liye email verification (V10) chali hui honi chahiye, warna "verified voters" ka matlab nahi banta.
- Prize aur sponsor ke sath logon se kiya gaya wada (rules, kab tak prize milega) aap ki zimmedari hai. Contest page par likha rehta hai ke winner verified voters mein se random chuna jata hai.
- Telegram ka token kabhi git mein na daalein, sirf Render ke Environment mein rakhein.

## Check kaise karein
1. Naya contest banayein jis mein sponsor aur prize ho. Homepage par "🔥 Live now" nazar aana chahiye (pin kiya ho to pehle).
2. Dusre account se (verified email wale) vote dein, contest ko "Close voting" karein, "Pick a random winner" dabayein.
3. Sponsor ke naam par click karein, phir /votes/ID/report kholein: click ginti mein aana chahiye.
4. Telegram jora ho to channel mein naya contest, result aur giveaway winner ki post dekhein.
