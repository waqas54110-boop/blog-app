# V4: naye features (setup guide)

Koi nayi npm package add nahi hui, phir bhi `npm install` ek baar chala lein.

## 1. Database (zaroori, ek baar)
`migration_v4.sql` ko apni database par run karein (Neon: SQL Editor mein paste karke Run;
local: `psql -d blog_db -f migration_v4.sql`). Dobara run karna safe hai.
Ye 3 cheezein karta hai:
- `posts.slug` column, aur purani posts ke slugs title se bana deta hai
- `images` table (uploaded images)
- `password_resets` table

**Deploy se PEHLE migration run karein**, warna site error degi (code ab `slug` column use karta hai).

## 2. Kya naya hai
| Feature | Kahan |
|---|---|
| Password reset | `/forgot-password`, `/reset-password/:token`, login page par "Forgot password?" link |
| SEO slugs | post ka link ab `/posts/my-post-title`. Purane `/posts/12` links khud (301) naye link par jate hain |
| Image upload | editor mein cover ke saath **Upload** button, aur content ke upar **Insert image** button |
| Pagination | home page: `1 ... 4 5 6 ... 20`, "Showing 7-12 of 40", galat page number par aakhri page par redirect |
| Dark mode | device ki setting follow karta hai, toggle button se badal sakte hain; login/signup pages aur analytics chart bhi |

## 3. Password reset ke baare mein
- Email ke liye `SMTP_*` aur `SITE_URL` `.env` mein zaroori hain (`.env.example` dekhein).
- Link 60 minute tak chalta hai aur sirf ek baar. Database mein token ka sirf hash rehta hai.
- Password badalte hi us user ki purani login sessions band ho jati hain.
- Agar `SMTP_*` set nahi, to reset link server ke console/log mein print hota hai (Render: Logs tab).
- Jawab hamesha ek jaisa hota hai, isliye koi ye pata nahi laga sakta ke kis email par account hai.

## 4. Slugs ke baare mein
- Naye post par slug title se khud banta hai, ya editor ke "URL slug" field mein khud likhein.
- Post edit karne par slug **wahi rehta hai** (purane links na tootein). Sirf field khud badlein to badalta hai.
  Slug badalne par purana slug kaam nahi karega.
- Sitemap, RSS, newsletter aur notifications sab naye links use karte hain.

## 5. Image upload ke baare mein
- Sirf admin upload kar sakta hai. JPG, PNG, WebP, GIF allowed hain (SVG nahi, security ki wajah se).
- Images **database (Neon) mein** save hoti hain, is liye Render par redeploy se ghaib nahi hotin.
- Browser upload se pehle image ko max 1600px aur WebP mein compress karta hai (aam photo ~100-300 KB).
  Har image ki limit 5 MB hai.
- Neon free plan mein storage kam hoti hai. Bohot zyada images ho jayen to Cloudinary/S3 par shift karna behtar hoga.

## 6. Pagination
Ek page par posts ki tadaad `.env` mein `POSTS_PER_PAGE` se badal sakte hain (default 6).
