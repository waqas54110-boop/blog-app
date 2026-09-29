# V6: Video upload + Hire Me inbox (setup guide)

Do naye features:
1. **Video upload** (MP4 / WebM) post ke andar, aur **YouTube embed** button.
2. **💼 Hire Me page + 📥 Inbox**: visitor apna kaam bata kar form bhejta hai, aap ko email aati hai,
   aur admin inbox mein saari inquiries ek jagah (New / Replied / Closed) nazar aati hain.

## 1. Deploy karne ke 2 qadam (is tarteeb se)

1. **Database (ek baar, deploy se PEHLE):** `migration_v6.sql` ko Neon SQL Editor mein paste karke Run karein.
   Dobara run karna safe hai. Ye do nayi tables banata hai: `videos` aur `inquiries`.
2. `git add -A && git commit -m "V6 video upload + hire me" && git push` (Render khud deploy kar dega).

Koi nayi npm package nahi, is liye `package.json` / lock file nahi badli.

## 2. Video kaise daalein
Editor mein content ke upar **Insert video** dabayein, MP4/WebM chunein. Upload ke saath percent dikhta hai,
phir post mein `<video src="/video/5" controls></video>` khud lag jata hai.

**YouTube** button: video ka link paste karein, post mein embed lag jata hai (privacy-friendly `youtube-nocookie`).

| Cheez | Detail |
|---|---|
| Format | MP4 (H.264) ya WebM. iPhone `.mov` ko pehle MP4 export karein |
| Hadd | Default 30 MB (`VIDEO_MAX_MB`, max 100) |
| Kaun upload kare | Sirf admin |
| Seek / phone | Range support hai, video aage-peechay hoti hai aur Safari par bhi chalti hai |
| Safety | File ki asli pehchan check hoti hai (naam badal kar exe upload nahi ho sakti). Post mein sirf apni `/video/…` aur YouTube ka embed chalta hai, baaqi iframe/script saaf ho jate hain |

**Zaroori:** videos Neon database mein save hoti hain aur free plan mein kul 0.5 GB jagah hai.
30 MB ki 10 videos = 300 MB, yani jagah jaldi bhar sakti hai. **Bari ya lambi videos YouTube par upload karke
"YouTube" button use karein.** Upload ki hui video ko post se hata dein to bhi wo database mein rehti hai. Jagah dekhne ke liye:
```sql
SELECT COUNT(*) AS videos, pg_size_pretty(SUM(size)) AS total FROM videos;
```
Purani/unused video hatane ke liye: `DELETE FROM videos WHERE id = 5;` (id wo jo `/video/5` mein hai).

## 3. Hire Me + Inbox
- Navbar mein **💼 Hire Me** (`/hire`). Form: naam, email, kya chahiye, budget (optional), details.
- Nayi inquiry par aap ko **email** aati hai (SMTP set ho tab). Us email par Reply dabayein to seedha client ko jayega.
- Admin menu mein **Inbox** (naye messages ka red number ke saath), aur Dashboard par bhi button.
- Har inquiry par: **Reply by email**, Mark replied, Close, Reopen, Delete.
- Spam se bachao: chhupa hua honeypot field, ek IP se 1 ghante mein 5 messages, CSRF.
- Services badalni hon to `.env` / Render Variables mein `HIRE_SERVICES` (comma se alag).
- Email kisi aur address par chahiye to `INQUIRY_EMAIL`. Khali ho to admin account ki email use hoti hai.

## 4. Check kaise karein
1. Editor kholein, Insert video se chhoti MP4 daalein, post save karke kholein, video chalni chahiye aur seek honi chahiye.
2. "YouTube" button se koi link daalein, embed nazar aana chahiye.
3. Logout hoke `/hire` par test message bhejein, phir admin se **Inbox** kholein.
