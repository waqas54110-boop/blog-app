# V49: 60 second funny TikTok videos (vote contests + shop products) 🎬

Koi SQL migration nahi chahiye. Naya package bhi install nahi karna.

## Kya naya hai
1. **Vote TikTok studio ab 60 second ki** (pehle 12 second): hook, option spotlight, VS fight, chacha-phupho debate, countdown, "link in bio".
   - Funny captions khud aate hain (voice file ke baghair).
   - Siren / boing / airhorn / beat khud banti hai (browser mein, koi audio file nahi).
   - Voice scripts lambe hain (60 second ke liye). Voice upload karein to video us ke hisaab se lambi (max 75 sec).
2. **Shop mein TikTok video** `/shop/<shop>/<product>/tiktok` (sirf shop owner / admin):
   - Product ki photos (4 tak), price, kati hui purani qeemat, % off, stock se 60 second ki English funny video.
   - Naya theme: emerald + gold, polaroid photo frames, price stickers, money rain, "Wallet vs Me" skit, "Only N left!", "Pay on delivery".
   - English funny voice scripts (Wallet cries / Mom vs Me / Movie trailer), voice command (edge-tts, English voices).
   - Button: product page par (owner ko) aur **Seller > My products** mein "🎬 TikTok video".
3. **Chhota TikTok link** `/tp/<product id>` -> product page, source = `tiktok`. TikTok bio mein lagayein.
   - Alag video ke liye: `/tp/12?c=video2`.

## Files
Naye: `views/shop-tiktok.ejs`, `SETUP_V49.md`
Badli: `views/vote-tiktok.ejs`, `routes/votes.js`, `routes/shop.js`, `views/shop-product.ejs`, `views/seller-products.ejs`

## Istemal (shop)
1. Deploy (git push).
2. Seller > My products > **🎬 TikTok video** (ya product page par).
3. **Create video (60 sec)**, tab khula rakhein.
4. Download / Share, TikTok par upload, caption paste, bio mein `/tp/<id>` link.

## Zaroori baatein
- TikTok description / comments mein link clickable nahi hota, is liye "Link in bio".
- Chrome (Android / desktop) `.mp4` banata hai; baaz browsers `.webm`.
- Product ki photos isi site ki hoti hain (/img/...), is liye video mein theek aati hain.
