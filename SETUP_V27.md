# V27: Post box mein 🔴 Live (live broadcasting)

## Kya naya hai
- Home feed aur group ke post box mein **📷 Photo** ke saath ab **🔴 Live** button hai.
- Dabane par camera ka preview khulta hai, caption likh sakte hain (post box mein jo likha ho wo khud aa jata hai), phir **Go live**.
- Live shuru hote hi feed mein ek nayi post banti hai jis par **🔴 LIVE · N watching** aur **▶ Watch live** button hota hai.
- Dekhne wala Watch live dabaye to full-screen video khulti hai (viewers ki ginti ke saath).
- Host ke paas: mute, camera on/off, front/back camera badalna, End live, aur live ka timer.
- Live khatam hone par post par "⚫ Live ended · 12:30 · up to 4 watching" likha rehta hai.
- Followers ko "🔴 X is live now" ki notification jati hai (group ke live par nahi).
- Live post delete karne se live bhi khatam ho jata hai.

## Deploy ke steps
1. **migration_v27.sql** Neon SQL Editor mein run karein (deploy se PEHLE). Dobara run karna safe hai.
2. Zip ki files project mein copy karein, phir `git push` (koi nayi npm package nahi chahiye).
3. Do alag browsers / phones se do alag accounts se test karein: ek live jaye, doosra Watch live dabaye.

## Settings (Railway Variables, sab optional)
| Variable | Default | Matlab |
|---|---|---|
| `LIVE_MAX_VIEWERS` | 6 | Ek live mein ek saath kitne log dekh sakte hain (max 15) |
| `LIVE_ADMIN_ONLY` | band | `1` likhein to live sirf admin kar sakta hai |

TURN server: V26 (calls) wali `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` yahan bhi use hoti hain. Mobile data par bina TURN ke kai viewers ko "Could not connect" aa sakta hai.

## Hadood (jo jan lein)
- **Viewers ki hadd:** ye WebRTC peer-to-peer hai, koi media server nahi. Host ka phone/laptop har viewer ko alag video bhejta hai, is liye 6 viewers par host ko lagbhag 3-4 Mbps upload chahiye. Is se zyada audience (sau, hazar log) ke liye media server chahiye (LiveKit, Agora, Cloudflare Stream). Wo alag kaam hai, chahein to bata dein.
- **Recording / replay nahi:** live khatam hone par video kahin save nahi hoti, sirf post par "Live ended" rehta hai.
- **Dekhne ke liye login zaroori hai** (guest ko "Log in to watch" dikhta hai). Block kiye hue log aur private group ke bahar walay nahi dekh sakte.
- **Host ko page khula rakhna hai.** Page band / refresh / doosre link par jane se live khatam ho jata hai (browser pehle poochta hai). Tab background mein ho ya phone lock ho to 25 second baad live khud khatam ho jata hai. Screen on rakhne ki koshish khud hoti hai (Wake Lock).
- Live ke dauran comments post par likhe ja sakte hain, lekin wo live screen par nazar nahi aate (page refresh par dikhte hain).
- Har host aur viewer har 1-1.5 second ek halka query chalata hai (calls jaisa). Bohat se live ek saath hon to Neon par load barh sakta hai.
- Live ka caption spam filter se guzarta hai; admin par filter nahi chalta.
