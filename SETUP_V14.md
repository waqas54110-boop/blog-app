# V14: Friend requests (Facebook jaisa)

| Kya | Kahan |
|-----|-------|
| **Friends page** | `/friends` (menu mein 👫 Friends, request aaye to red badge). 3 tabs: **People** (sab registered users + search), **Requests** (aayi hui / bheji hui), **My friends** |
| **Profile par** | `/u/username` par **👋 Add friend** / Request sent / Accept / ✓ Friends |

## Kaise chalta hai
1. User **Add friend** dabata hai -> samne wale ko 🔔 notification: "X sent you a friend request".
2. Samne wala **Accept** kare -> dono ek doosre ko **follow** karne lagte hain (purana follow system: naya post/contest par notification + email). Bhejne wale ko bhi notification jati hai.
3. **Decline / Cancel** par request hat jati hai (kisi ko notification nahi).
4. **Unfriend** par dosti aur dono taraf ka follow khatam.
5. Agar A ne B ko request bheji aur B ne bhi A ko bhej di, to seedha accept ho jati hai.

Purana **➕ Follow** button waisa hi hai (bina request ke follow).

## Deploy
1. `migration_v14.sql` Neon SQL Editor mein run karein (dobara run karna safe hai). `migration_v13.sql` pehle chali honi chahiye.
2. `git add -A && git commit -m "V14 friend requests" && git push origin main`

Koi nayi npm package ya env variable nahi.
