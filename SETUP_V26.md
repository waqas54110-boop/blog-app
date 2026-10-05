# V26: Voice call + Video call (chat mein)

## Kya naya hai
- Chat page ke upar naam ke saath do button: 📞 (voice call) aur 🎥 (video call). Sirf friends aapas mein call kar sakte hain (block wale nahi).
- Aane wali call kisi bhi page par full-screen popup + ghanti (aur phone par vibration) ke saath aati hai: Accept / Decline.
- Call screen: mute, camera on/off, camera badalna (front/back), end call, aur chalti call ka timer.
- Call khatam hone par chat mein ek line likh jati hai: "📞 Voice call · 2:31", "🎥 Missed video call", "📞 Voice call declined".
- Missed call par notification bhi jati hai.
- Koi aur call par ho to "on another call" ka message milta hai.

## Deploy ke steps
1. **migration_v24.sql** Neon SQL Editor mein run karein (deploy se PEHLE). Dobara run karna safe hai.
2. Zip ki files project mein copy karein, phir `git push` (koi nayi npm package nahi chahiye).
3. Do alag browsers / phones se do alag friend accounts se test karein.

## ZAROORI: TURN server (warna kai logon ki call nahi lagegi)
Call ki awaaz / video seedhi browser se browser jati hai. Google ka free STUN server (code mein pehle se hai) sirf asaan networks par kaam karta hai. Mobile data (Jazz, Zong, Telenor...) aur kai WiFi par "symmetric NAT" hota hai, wahan TURN relay server chahiye.

Railway ke Variables mein ye dalein (kisi TURN provider se milte hain, jaise Metered, Twilio, Cloudflare ya apna coturn server):

| Variable | Misaal |
|---|---|
| `TURN_URLS` | `turn:your-turn-host:3478,turns:your-turn-host:443?transport=tcp` |
| `TURN_USERNAME` | provider ka username |
| `TURN_CREDENTIAL` | provider ka password |

Optional: `STUN_URLS` (comma se alag) agar apna STUN lagana ho.
TURN bina test kiye na chhodein: ek banda mobile data par aur doosra WiFi par rakh kar call karke dekhein. Agar "Could not connect..." likha aaye to TURN chahiye ya TURN ki details ghalat hain.

## Hadood (jo jan lein)
- **Aane wali call tab hi ring hoti hai jab dosray banday ka tab kisi page par khula ho** (har 4 second check hota hai). Site band ho ya browser background mein ho to ring nahi hogi, sirf notification aur "Missed call" ka message milega. Aap ka push system abhi sab ko ek saath bhejta hai, har bande ko alag nahi, is liye call ke liye push abhi nahi lagaya.
- Call ke dauran page badalna (doosre link par jana) call kaat deta hai. Browser pehle poochta hai.
- Sirf 1-to-1 call hai, group call nahi.
- Browser ko HTTPS chahiye (Railway par hai) aur mic / camera ki ijazat.
- Is ke liye har logged-in tab har 4 second ek halka sa query chalata hai (aane wali call ka pata karne ke liye). Bohat zyada users hon to Neon par load barh sakta hai.
