# V34: People's Court + Raise Your Voice (Petitions)

## Deploy se PEHLE
1. `migration_v34.sql` ko Neon SQL Editor mein ek baar run karein (migration_v30.sql ke baad). Dobara run karna safe hai.
2. Code deploy karein. Koi nayi npm package ya .env setting nahi chahiye.

## People's Court (/court)
- Admin: menu -> People's Court -> "New case" (/court/new). Sawal, neutral background, do sides, lawyer sign-up ghante, jury ghante.
- Koi bhi login user ek side ka wakeel ban kar dalail deta hai (min 120 characters). Dalail baad mein badli nahi hoti.
- Dusra wakeel aate hi jury ka timer shuru. Awam vote karti hai (wakeel vote nahi de sakta). Vote dene se pehle result nahi dikhta.
- Wakeel ke personal link (?via=a/b) se aane wale jurors gine jate hain ("brought N jurors").
- Waqt khatam hone par har minute chalne wala scheduler verdict save karta hai, sab ko notification jati hai, aur Telegram set ho to channel mein post.
- Share card: /og/court/ID.png (1200x630). Admin: lawyers ko 24 ghante aur dena, jury abhi khatam, hide, delete.

## Raise Your Voice (/petitions)
- Koi bhi login user petition shuru karta hai (title, shehar, area, topic, masla, optional photo). Roz max 3, active max 10.
- Signature ek user ek baar. Login se pehle "Sign" dabane par login ke baad khud lag jata hai.
- Milestones 10/50/100/250/500/1000... par creator ko notification. 100+ par admin ko bhi.
- Admin page /admin/petitions (menu mein "Petition milestones"): milestone wali petitions ka share card download karein, caption copy karein, Facebook / X par post karein, phir "Posted" dabayein.
- Creator updates post karta hai (sab signers ko notification), "Resolved" ya "Close" kar sakta hai.
- Report button dono mein hai, aur /admin/moderation mein aati hain. Sitemap mein /court aur /petitions shamil hain.

## Nayi files
lib/court.js, lib/courtcard.js, lib/petitions.js, lib/petitioncard.js, routes/court.js, routes/petitions.js,
views/court*.ejs, views/petition*.ejs, views/admin-petitions.ejs, views/partials/{court-card,petition-card,petition-assets}.ejs, migration_v34.sql

## Badli hui files
app.js (routes, rate limits, scheduler), views/partials/header.ejs (nav + menu), lib/moderation.js, routes/moderation.js,
views/moderation.ejs, views/partials/report-modal.ejs, lib/images.js (petition photos orphan na hon), routes/posts.js (sitemap + robots)
