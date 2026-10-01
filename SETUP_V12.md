# V12: Images Cloudinary par

Neon ka free plan sirf 0.5 GB hai, aur har contest ki 2 photos database mein jati thin. Ab nayi images Cloudinary (free storage) par jati hain. `/img/ID` wale links wahi rehte hain, is liye purani posts/contests nahi tootte.

## Qadam (is tarteeb se)
1. **cloudinary.com** par free account banayein. Dashboard mein "API Environment variable" wali line copy karein (`cloudinary://KEY:SECRET@CLOUDNAME`).
2. **Neon SQL Editor** mein `migration_v12.sql` run karein (deploy se PEHLE).
3. **Render -> Environment** mein `CLOUDINARY_URL` daalein (secret git mein na daalein).
4. `git add -A && git commit -m "V12 cloudinary images" && git push origin main`
5. Naya contest/post banayein aur photo upload karein: image Cloudinary Media Library ke `blog` folder mein nazar aani chahiye.
6. **Purani images move karna (optional, jagah wapas lene ke liye)**, apne computer par `.env` mein `DATABASE_URL` aur `CLOUDINARY_URL` rakh kar:
   - `node scripts/move-images-to-cloudinary.js` (sirf ginti dikhata hai)
   - `node scripts/move-images-to-cloudinary.js --go` (asal move)
   - Neon SQL Editor mein `VACUUM FULL images;` (tab Neon ki jagah wapas milti hai)

## Dhyan rakhein
- `CLOUDINARY_URL` na ho ya Cloudinary down ho to upload khud database mein save ho jata hai, kaam rukta nahi.
- Cloudinary ki free hadd hoti hai (storage + bandwidth); dashboard par kabhi kabhi dekh lein.
- Videos abhi bhi database mein jati hain (max `VIDEO_MAX_MB`), ye change sirf images ke liye hai.
