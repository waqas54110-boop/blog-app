# V43 - Facebook Signup Wall

Facebook se aane wala visitor (jisne login nahi kiya) post ke sirf pehle 3 paragraph parh sakta hai.
Neeche blur/fade + "Poori story parhne ke liye free account banao" wala card aata hai.
Signup ya login (Google bhi) ke baad wo khud usi post par wapas aa jata hai, ab poori post khuli hoti hai.

## Migration: KOI NAHI

## Files (same jagah replace/add karo)
- lib/fbwall.js      -> NAYA
- config.js          -> 2 naye setting (fbWall, fbWallBlocks)
- routes/posts.js    -> require + wall logic (post route mein)
- routes/auth.js     -> signup/login par "is post ke liye account banao" message
- views/post.ejs     -> wall card; wall par comments/reactions/poll chhup jate hain
- views/signup.ejs, views/login.ejs -> banner
- .env.example

## Kaun "Facebook visitor" hai
- link mein utm_source=facebook (aap ke Share button wala link), ya ?fbclid=...
- Referer facebook.com / l.facebook.com / fb.me / messenger.com
- Facebook app ka in-app browser (user-agent mein FBAN/FBAV)

## Kis par wall NAHI lagti
- login user, admin
- bots: facebookexternalhit (Facebook ka share preview), Googlebot, WhatsApp preview. Is liye share card, title, image sab theek rehta hai aur Google index poori post dekhta hai.
- jis post mein 3 se kam paragraph hon (wall ka faida nahi).
- Google / WhatsApp / direct se aane wale: wo poori post parhte hain.

## Settings (Railway Variables, optional)
- FB_WALL=0        -> wall band
- FB_WALL_BLOCKS=2 -> kitna hissa free (1 se 15, default 3)

## Deploy
    cd ~/Pictures/first_backup
    cp -r ~/Pictures/first/{views,routes,lib,config.js,.env.example,SETUP_V43.md} .
    git add . && git commit -m "V43: facebook signup wall" && git push

## Test kaise karein
Logout karke browser mein kholo:  https://<aap-ki-site>/posts/<slug>?utm_source=facebook
Wall dikhni chahiye. Bina ?utm_source ke wahi post poori khulegi.
