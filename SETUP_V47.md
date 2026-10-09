# V47: TikTok vote video + TikTok traffic tracking 🎵

Koi SQL migration nahi chahiye. Naya package bhi install nahi karna.

## Kya naya hai
1. **TikTok Video Studio** `/votes/<id>/tiktok`
   - Browser mein hi 9:16 (vertical) 12 second ka video banta hai: hook, title, dono options ki photo, VS, "Link in bio to vote", chhota link.
   - Option: "Show current result %" (video par abhi ka result).
   - Mobile par **Share video to TikTok** (share sheet se TikTok app), warna **Download**.
   - Caption + hashtags + bio link, teeno ke Copy buttons.
2. **Chhota TikTok link** `/t/<id>` (jaise `/t/5`) -> contest page, source = `tiktok`. Ye link TikTok profile bio mein lagana hai.
   - Alag video/campaign ke liye: `/t/5?c=video2` (analytics mein campaign alag dikhega).
3. **TikTok traffic ki pehchan**: link se aaye, ya TikTok ke in-app browser se aaye, dono `tiktok` source ginte hain (Vote report aur /analytics mein dikhega, TikTok ka laal rang).
4. TikTok se aaye visitor ko vote page par "Welcome from TikTok" banner dikhta hai.
5. Vote page ke Share buttons mein **🎵 TikTok video** button.

## Files
Naye: `views/vote-tiktok.ejs`, `SETUP_V47.md`
Badli: `routes/votes.js`, `lib/analytics.js`, `views/vote.ejs`, `views/analytics.ejs`, `app.js`

## Istemal
1. Deploy (git push).
2. Contest kholo -> **🎵 TikTok video** -> **Create video** (12 second, tab khula rakho).
3. Video TikTok par upload karo, caption paste karo.
4. TikTok profile bio mein `https://<aapki-site>/t/<id>` lagao.
5. Dekhne ke liye: contest ka report / /analytics mein source `tiktok`.

## Zaroori baatein
- TikTok video description ya comments mein link **clickable nahi hota**. Is liye video mein "Link in bio" likha hai. Bio link ke liye Business account sab se aasan hai.
- Chrome (Android/desktop) `.mp4` banata hai. Kuch browsers sirf `.webm` banate hain, TikTok usay na le to CapCut se convert karein.
- Video banate waqt tab screen par khula rahe (background mein recording ruk sakti hai).
- Video ki images isi site ki honi chahiye (/img/...). Bahar ki image CORS ki wajah se na dikhe to gradient dikhega.
