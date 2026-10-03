# V20: Stories, Groups aur App ki tarah install (PWA)

| Feature | Kahan dikhta hai |
|---------|------------------|
| **Stories** | Home feed ke upar gol icons. **Add story** (+) se text ya photo. 24 ghante baad khud khatam |
| **Groups** | Menu mein **🫂 Groups** (`/groups`). Har group ka apna page `/groups/cricket` aur apni feed |
| **PWA install** | Menu mein **📲 Install app** (jab browser ijazat de). Home screen par icon, offline page |

## Stories
- **Banana:** feed ke upar **Add story**. **Aa Text** (6 rang ke background, max 300 characters) ya **📷 Photo** (caption optional).
- **Dekhna:** gol icon par click. Rang wali ring = nayi story, grey ring = dekh li. Screen ke right side tap = agli, left side tap = pichli, dabaye rakho = ruk jati hai. Keyboard: ← → aur Esc.
- **Tarteeb:** pehle apni, phir jin ki nayi stories hain (follow kiye hue pehle), phir baaqi.
- **Owner ke liye:** apni story par **👁 views** dabayen to dekhne walon ke naam. 🗑️ se story hata sakte hain. Admin kisi ki bhi story hata sakta hai.
- **24 ghante:** story ke baad query hi usay nahi dikhati. Har 30 minute mein purani rows (aur database wali photos) hat bhi jati hain.
- **Hadd:** ek user ki ek waqt mein 20 stories, 15 stories / 30 min. Block kiye hue log ek doosre ki stories nahi dekhte. Shak wali text (spam filter) rok di jati hai.
- Photo wahin jati hai jahan feed ki photos jati hain (Cloudinary ya database). Cloudinary par expire hone ke baad photo reh jati hai (feed posts ki tarah).

## Groups
- `/groups`: sab groups, search, **Join**. Apne groups pehle.
- **Group page:** upar naam / icon / members, andar group ki apni feed. Join karne walay post kar sakte hain (photo bhi). Join na karne walay parh sakte hain (public).
- **Group ki post** wahi feed post hai: like, comment, report, views, spam filter, block sab pehle jaisa. Ye post home ke **Everyone** aur profile mein nahi aati; sirf group mein, aur home par **🫂 My Groups** tab mein (aap ke joined groups ki posts).
- **Banana:** **➕ Create group** (naam 3-40 characters, icon emoji, description). Banane wala group admin hota hai, ek user max 5 groups. Sirf admin ko ijazat dena chahein to `.env` mein `GROUPS_ADMIN_ONLY=1`.
- **Group admin** group ki kisi bhi post / comment ko delete kar sakta hai. Owner group delete kar sakta hai (posts bhi jati hain). Owner khud leave nahi kar sakta.
- Migration khud do groups bana deti hai: **Cricket Talk 🏏** (`/groups/cricket`) aur **Freelancing Hub 💼** (`/groups/freelancing`), pehle admin account ke naam par. Naam / description badalna ho to Neon SQL Editor mein `UPDATE groups SET ... WHERE slug = 'cricket';`.

## PWA (app ki tarah install)
- **Install:** Android / Chrome / Edge par menu mein **📲 Install app** aata hai. iPhone Safari par bhi button aata hai (Share → Add to Home Screen ki hidayat dikhata hai).
- **Home screen icon:** site ke pehle harf ka icon (192, 512, Android ke gol shape ke liye maskable, aur iPhone ke liye 180). Icon par long-press karne par shortcuts: Feed, Groups, Blog.
- **Offline page:** internet na ho aur koi page kholein to `/offline` dikhta hai ("Try again" button, net wapas aate hi khud reload). Page ke andar chhota "You're offline" message bhi aata hai.
- **Caching:** sirf offline page, icons, aur images / avatars. Login wale pages aur JSON kabhi cache nahi hote (privacy).
- Icons ke liye `sharp` chahiye (pehle se hai). Agar kisi server par `sharp` na chale to install option nahi aayega.
- Service worker ka code `pwa/sw.js` mein hai. Cache badalna ho to us ke upar `VERSION` badal dein.

## Deploy ke qadam (is tarteeb se)
1. **Database (deploy se PEHLE):** `migration_v20.sql` Neon SQL Editor mein paste karke Run karein. Dobara run karna safe hai.
2. `git add -A && git commit -m "V20 stories, groups, PWA" && git push origin main`

Koi nayi npm package nahi. Naya environment variable sirf optional: `GROUPS_ADMIN_ONLY`.

**Zaroori:** migration deploy se pehle chalayein. Warna home feed error dega (kyunke ab feed ki query `group_id` dekhti hai).

## Dhyan rakhne ki baat
- **PWA sirf HTTPS par** chalta hai (Render par theek hai; local par `localhost` bhi chalta hai).
- Service worker update ke baad users ko naya version agli dafa page kholne par milta hai.
- **Stories ko report karne ka button abhi nahi** (feed posts / comments ka hai). Abhi: owner / admin hata sakta hai, block kar sakte hain, aur text par spam filter chalta hai. Chahein to agla step ban sakta hai.
- Groups abhi sab ke liye khule hain (private groups, join requests, kisi member ko nikalna abhi nahi).
- Group ki posts par followers ko notification nahi jati (sirf like / comment ki in-app notification, feed posts ki tarah).
