# V17: Edit profile

| Feature | Kahan dikhta hai |
|---------|------------------|
| **Edit profile page** | `/settings/profile`. Menu (naam wala dropdown) mein **✏️ Edit Profile**, aur apni profile par **✏️ Edit profile** button |
| **Username badalna** | Edit page par. 3 se 30 characters (letters, numbers, `.`, `-`, `_`). Har **30 din** mein sirf ek baar. Pehle se maujood naam (chhote/bade harf ka farq nahi) nahi mil sakta |
| **Bio** | Max 200 characters, profile ke header mein dikhti hai. Links allowed nahi (spam se bachao) |
| **Location** | Max 60 characters, profile par 📍 ke sath |
| **Photo** | Pehle ki tarah apni profile par Add / Change / Remove |

## Dhyan rakhne ki baat
- Username badalne par purana link `/u/purana-naam` kaam karna band ho jata hai (naya link `/u/naya-naam` ban jata hai). Purani notifications mein agar purane naam ka link ho to wo nahi khulega.
- Email yahan se nahi badalti.
- Jin ke purane username mein space ya khaas characters hain (purane signup par allowed tha), wo bio/location edit kar sakte hain bina naam badle. Naam tab hi check hota hai jab wo use badlen.

## Deploy ke qadam (is tarteeb se)
1. **Database (deploy se PEHLE):** `migration_v17.sql` Neon SQL Editor mein paste karke Run karein. Dobara run karna safe hai.
2. `git add -A && git commit -m "V17 edit profile" && git push origin main`

Koi nayi npm package nahi. Koi naya environment variable nahi.

**Zaroori:** migration deploy se pehle chalayein. Warna Edit profile page error dega (baqi site chalti rahegi; profile par bio/location bas nahi dikhenge, console mein error likha aayega).
