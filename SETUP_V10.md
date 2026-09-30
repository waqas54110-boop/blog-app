# V10: Email verification + Google login

| Feature | Kya hota hai |
|---------|--------------|
| **Email verification** | Signup par email mein 24 ghante wala link jata hai. Verify kiye bagair login nahi hota, is liye fake email se account bana kar votes / leaderboard kharab nahi kiye ja sakte |
| **Link dobara bhejna** | Verify na hui email wala banda login karne ki koshish kare to "Verification link dobara bhejein" button nazar aata hai |
| **Google login** | Login aur Signup dono page par "Continue with Google". Naya banda ek click mein account bana leta hai (email Google se verified aati hai) |

## Deploy ke qadam (is tarteeb se)
1. **Database (deploy se PEHLE):** `migration_v10.sql` Neon SQL Editor mein paste karke Run karein. Dobara run karna safe hai.
   - Jo users pehle se hain wo khud **verified** ho jate hain (warna sab lock ho jayenge).
   - `password_hash` ab khali (NULL) ho sakta hai, Google users ke liye.
2. **Google keys** (agar Google login chahiye, neeche dekhein), phir Render ke Environment mein `GOOGLE_CLIENT_ID` aur `GOOGLE_CLIENT_SECRET` daalein.
3. `git add -A && git commit -m "V10 email verification + google login" && git push origin main`

Koi nayi npm package nahi.

## Google keys kaise banayein
1. https://console.cloud.google.com par project banayein (ya purana chunein).
2. **APIs & Services -> OAuth consent screen**: app ka naam, apni email; User type "External". Scopes mein sirf `openid`, `email`, `profile` (ye default hain, review ki zaroorat nahi).
   Publishing status **"In production"** kar dein, warna sirf "test users" login kar sakte hain.
3. **Credentials -> Create credentials -> OAuth client ID -> Web application.**
4. **Authorized redirect URIs** mein bilkul ye daalein (SITE_URL wala hi domain, aakhir mein slash nahi):
   `https://your-blog.onrender.com/auth/google/callback`
   Local test ke liye alag se: `http://localhost:3000/auth/google/callback`
5. Client ID aur Client secret ko `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` mein daalein. Dono khali hon to Google button nazar hi nahi aata.

## Zaroori baatein
- **SMTP set hona chahiye** (Brevo/Resend, jaise newsletter ke liye). SMTP khali ho to verification email ja hi nahi sakti, is liye us surat mein naye accounts **khud verified** ho jate hain (aur login band nahi hota). Link console log mein bhi likha jata hai.
- **Purane account + Google:** agar Google ki email kisi maujooda account ki email se milti hai to wahi account Google se jur jata hai (naya nahi banta). Agar wo purana account **verify nahi tha**, to us ka password hata diya jata hai (kisi ne doosre ki email se signup kiya ho to wo andar na aa sake); asli malik "Forgot password" se naya password bana sakta hai.
- **Google-only users** ka password nahi hota: wo Google button se aate hain, ya "Forgot password" se password bana lein.
- **Forgot password** se password badalne par email bhi verified ho jati hai (reset email milna hi saboot hai).
- Link mein `SITE_URL` istemal hota hai, is liye wo set zaroor ho.

## Check kaise karein
1. Naye email se signup -> email mein link -> click -> login. 2. Verify se pehle login karke dekhein: block hona chahiye.
3. Login page par "Continue with Google". 4. Purane admin account se login abhi bhi chalna chahiye.
