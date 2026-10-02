# V15: Block / Report user, Private messages, Profile photo

| Feature | Kahan dikhta hai |
|---------|------------------|
| **Block user** | Profile par **⋯ More → ⛔ Block user**, chat ke ⋯ menu mein bhi. Blocked list: `/friends?tab=blocked` (wahin se Unblock) |
| **Report user / message** | Profile ya chat ke ⋯ menu mein **🚩 Report user**; chat mein har aaye hue message ke neeche **Report**. Admin ko `/admin/moderation` queue mein (type "User" / "Private message") |
| **Private messages** | `/messages` (navbar mein 💬 + unread badge), `/messages/username` chat. Sirf **friends** ke darmiyan |
| **Profile photo** | Apni profile par **📷 Add photo / Change photo / Remove**. Har jagah (comments, leaderboard, friends, chat) photo dikhti hai, na ho to naam ka pehla harf |

## Block kya karta hai
- Block karte hi dosti khatam, dono taraf ka follow khatam, pending requests khatam.
- Blocked user friend request, follow ya message nahi bhej sakta. Dono ek doosre ko People list mein nahi dikhte.
- Chat kholne par blocked user ko sirf "You can't message this user" dikhta hai (ye nahi batata ke kis ne block kiya).
- Unblock se sirf block hatta hai. Dosti wapas nahi aati, dobara request bhejni hogi.

## Messages
- Sirf friends. Text only, max 1000 characters, ek message mein max 2 links.
- Page khula ho to naye messages har 6 second mein khud aa jate hain (tab chhupa ho to ruk jata hai).
- 🔔 notification sirf **pehle unread message** par jati hai (har message par nahi). Baqi ka hisab 💬 badge rakhta hai.
- Limit: 12 messages / minute.

## Report aur Moderation
- User ko ya **apne ko aaye hue** message ko report kar sakte hain (apna content / doosre ki chat report nahi hoti).
- Admin ko report kiye gaye message ka sirf wahi ek message dikhta hai, poori chat nahi.
- Admin actions: message ke liye **Delete / Keep**, user ke liye **Mark handled / Keep**. (Abhi site par "ban user" ka option nahi hai; user par action aap khud lete hain.)

## Profile photo
- Browser photo ko beech se square crop karke 256x256 JPEG bana deta hai, phir upload hota hai (chhoti file, tez load).
- Cloudinary set ho to wahan, warna database mein (baqi images jaisa). Nayi photo lagane par purani row hat jati hai.

## Deploy ke qadam (is tarteeb se)
1. **Database (deploy se PEHLE):** `migration_v15.sql` Neon SQL Editor mein paste karke Run karein. (`migration_v13` aur `migration_v14` pehle chal chuki hon.) Dobara run karna safe hai.
2. `git add -A && git commit -m "V15 block, report, messages, avatar" && git push origin main`

Koi nayi npm package nahi. Koi naya environment variable nahi.

**Zaroori:** migration deploy se pehle chalayein. Warna header ka 💬 badge aur Messages/Blocked/photo kaam nahi karenge (site chalti rahegi, console mein error likha aayega).
