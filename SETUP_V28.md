# V28: Live mein bari audience (LiveKit) + recording save

## Kya naya hai
1. **Recording save:** live khatam hote hi host ka browser poori live ki video server par bhej deta hai ("Saving your recording… 40%"). Phir wo post par player ke saath hamesha rehti hai ("⚫ Live ended · 12:30" ke neeche). Post delete karne par recording bhi delete ho jati hai.
2. **Zyada viewers:** LiveKit (media server) lagane par saare viewers ek hi server se dekhte hain, host ka upload ek hi rehta hai. Hadd ab `LIVE_SFU_MAX_VIEWERS` (default 200, max 2000) hai, aur asal hadd aap ke LiveKit plan ki hai.
   - LiveKit ke teeno variables set na hon to purana tareeqa (seedha browser se browser, max 6 viewers) chalta rehta hai. Kuch toot'ta nahi.

## Deploy ke steps
1. **migration_v27.sql** (agar pehle nahi chali) aur phir **migration_v28.sql** Neon SQL Editor mein run karein (deploy se PEHLE). Dobara run karna safe hai.
2. Files copy karein, `git push`. Koi nayi npm package nahi chahiye.
3. Recording ke liye kuch aur nahi chahiye, wo khud kaam karti hai.

## LiveKit lagana (bari audience ke liye)
1. https://livekit.io par account banayein, ek Cloud project banayein.
2. Project ki Settings > Keys se **URL** (`wss://....livekit.cloud`), **API Key**, **API Secret** lein.
3. Railway Variables mein dalein:

| Variable | Misaal |
|---|---|
| `LIVEKIT_URL` | `wss://your-project.livekit.cloud` |
| `LIVEKIT_API_KEY` | project ki key |
| `LIVEKIT_API_SECRET` | project ka secret |
| `LIVE_SFU_MAX_VIEWERS` | `200` (optional) |

4. Deploy ke baad ek live shuru karein: ab nayi live "media server" mode mein hogi. Purani chalti live par asar nahi parta.
5. LiveKit ki free/paid limits (minutes, bandwidth) aap ke plan par hain; wahan ka usage dashboard dekhte rahein. Zyada viewers = zyada bandwidth = zyada bill.
6. LiveKit mode mein TURN ki alag zaroorat nahi, LiveKit apna relay khud deta hai.

## Recording ki settings
| Variable | Default | Matlab |
|---|---|---|
| `LIVE_RECORD_MAX_MB` | 60 | Ek recording ki max size. `0` = recording band. Max 200 |

Lagbhag andaza: 60 MB ≈ 10 minute, 200 MB ≈ 35 minute. Recording database (Neon) mein save hoti hai, is liye Neon ka storage jaldi bhar sakta hai. Zyada live karte hon to hadd chhoti rakhein ya purani live posts delete karte rahein.

## Hadood (jo jan lein)
- **Recording host ke browser mein hoti hai.** Agar host ka tab band ho jaye, browser crash ho ya internet chala jaye to us live ki recording save nahi hoti (live post par "ended" rehta hai, bina video ke).
- **Camera front/back badalne par recording ruk jati hai** (live chalti rehti hai). Us waqt tak ki recording save hoti hai. Browser poochta hai ke badalna hai ya nahi.
- Hadd (`LIVE_RECORD_MAX_MB`) poori ho jaye to bhi live chalti rehti hai, sirf pehla hissa save hota hai.
- Recording host ke apne camera ki quality (≈700 kbps) mein hoti hai. Chrome / Edge / Firefox par WebM, Safari par MP4 banti hai. WebM recordings mein kai browsers aage-peeche seek karna theek se nahi karte (live recording ki wajah se).
- Dekhne ke liye ab bhi login zaroori hai. Live ke dauran comments live screen par nazar nahi aate.
- Viewers ki ginti LiveKit mode mein har 5 second update hoti hai (p2p mein 1.5 second).
- **Test nahi hua:** ye code asli LiveKit account ke saath yahan chala kar nahi dekha ja saka. Pehli live ek chhote test se karein (do browsers). Agar LiveKit ki library na load ho ya video na aaye to browser console (F12) ka error bhej dein.
