# V18: Community Feed (Facebook jaisa photo post)

Blog ke asli articles ab bhi **sirf owner** likhta hai. Ye naya **Feed** alag hai: har login user apni photo / text post kar sakta hai, baqi sab dekh kar like aur comment kar sakte hain.

| Feature | Kahan dikhta hai |
|---------|------------------|
| **Feed page** | `/feed`. Menu mein **📸 Feed**. Login ke baghair bhi dekh sakte hain (post/like/comment ke liye login) |
| **Photo + text post** | Feed ke upar "What's on your mind?" box. **📷 Photo** dabayen, photo choose karein, preview aayega, phir **Post** |
| **Like ❤️** | Har post par, page reload ke baghair. Post ke owner ko notification jati hai |
| **Comment 💬** | Har post ke neeche, page reload ke baghair. Owner ko notification jati hai |
| **Share ↗** | WhatsApp, Facebook, ya Copy link. Har post ka apna link `/feed/12` (photo ke saath preview banta hai) |
| **Everyone / Following tab** | Login user ke liye. Following = jin ko follow karte hain (dost bhi) |
| **Load more** | 10 posts ek baar mein, neeche button se aur |
| **Meri posts** | Naam wale menu mein **📸 My Posts**. Kisi ki profile par posts ki ginti, click karein to uski posts |
| **Photo bari dekhna** | Photo par click, bada (lightbox) khulta hai |
| **Delete** | Post ka owner apni post, post ka owner apni post ke kisi bhi comment, comment ka owner apna comment. Admin sab kuch |
| **Report 🚩** | Post ke ⋯ menu aur har comment par. Admin ki **Moderation** queue mein aati hai (photo ka preview bhi) |
| **Spam filter** | Post aur comment par wahi filter jo blog comments par hai. Shak wali post "Pending review" mein jati hai (sirf owner + admin ko dikhti) |
| **Block** | Jis ne block kiya ho uski posts nazar nahi aatin, aur wo like/comment nahi kar sakta |
| **Theme** | Gradient banner, round cards, dark mode ke saath bhi sahi. Computer par left/right sidebar (aap ka card, naye blog posts, people you may know) |

## Hadd (limits)
- Post: max 2000 characters, ek photo. Ek jaisi post 10 minute mein dobara nahi.
- Photo browser mein khud 1600px JPEG ban kar upload hoti hai (tez, kam bandwidth). **GIF animation chali jati hai** (sirf pehli frame).
- Rate limit: 8 posts / 10 min, 12 comments / 5 min, 20 photo uploads / 30 min.
- Bahut reports (jitni `REPORT_AUTOHIDE` set hai, default 3) par post/comment khud chhup jata hai jab tak admin dekh na le.

## Deploy ke qadam (is tarteeb se)
1. **Database (deploy se PEHLE):** `migration_v18.sql` Neon SQL Editor mein paste karke Run karein. Dobara run karna safe hai.
2. `git add -A && git commit -m "V18 community feed" && git push origin main`

Koi nayi npm package nahi. Koi naya environment variable nahi.

**Zaroori:** migration deploy se pehle chalayein. Warna `/feed` error dega (baqi site chalti rahegi, console mein error likha aayega).

## Dhyan rakhne ki baat
- Photos wahin jati hain jahan baqi images jati hain: Cloudinary set hai to Cloudinary, warna database. Post delete hone par database wali photo ki row bhi hat jati hai; Cloudinary par photo reh jati hai (wahan se dastakhat hatani ho to Cloudinary dashboard se).
- Agar koi photo choose kare magar post kiye baghair tab band kar de, to wo upload ki hui photo database mein bachi reh sakti hai (bohat chhoti si baat).
- Feed ki posts ka email ya follower-notification abhi nahi (sirf like / comment ki in-app notification). Chahein to agla step ban sakta hai.
