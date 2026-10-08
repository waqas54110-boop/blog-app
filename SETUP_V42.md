# V42 - Group Poster (groups list, per-group UTM, caption copy, ✓ aaj post ho gayi, group-wise analytics)

## Pehle SQL chalao (Neon SQL Editor -> paste -> Run)
`migration_v42.sql` ka poora content paste karke Run karo. (Dobara chalane se koi nuqsan nahi.)
Jab tak SQL nahi chalta, site normal chalti rahegi; bas /poster par "migration chalao" ka message dikhega.

## Files (same jagah replace/add karo)
- app.js                     -> 2 naye line (posterRouter require + app.use)
- routes/poster.js           -> NAYA: groups save/delete, ✓ toggle, poster page
- views/poster.ejs           -> NAYA: poster page
- lib/analytics.js           -> utm_campaign (group ka naam) save hota hai
- routes/engage.js           -> /analytics mein group-wise query + CSV mein GROUPS section
- views/analytics.ejs        -> "Group-wise performance" table
- views/dashboard.ejs        -> "📣 Group Poster" button + har live post par "📣 Groups"
- routes/posts.js            -> robots.txt mein /poster block (sirf 1 lafz)
- migration_v42.sql

## Deploy
    cd ~/Pictures/first_backup
    cp -r ~/Pictures/first/{views,routes,lib,app.js,migration_v42.sql,SETUP_V42.md} .
    git status --short
    git add .
    git commit -m "V42: group poster + group-wise analytics"
    git push

## Kaise use karna hai
1. Dashboard -> "📣 Group Poster" (ya kisi post par "📣 Groups").
2. "➕ Groups add karo": har line mein `Naam | link` paste karo (ek dafa). Platform link se khud pehchan liya jata hai.
3. Caption box mein caption likho; `{link}` ki jagah har group ka apna UTM link lagta hai.
4. Group ke saamne:
   - 📋  = us group ka caption copy
   - ↗ Open group = group kholta hai AUR caption khud copy ho jata hai (wahan bas paste karo)
   - ✓  = "aaj is group mein post ho gayi" (har din naye sire se shuru; kal tick khud hat jata hai)
5. Analytics -> "Group-wise performance": har group ke visits, log, kitni dafa post hui, best post.

## UTM kaise lagta hai
Post ka link: `/posts/<slug>?utm_source=whatsapp&utm_medium=group&utm_campaign=<group-ka-naam>-<4 hex>`
Group ki apni invite link (chat.whatsapp.com/...) par UTM nahi lag sakta; UTM caption ke andar post ke link par lagta hai.

## Hadd (important)
- Views = wo log jinhon ne link par click kiya. Jo sirf message dekh kar guzar gaya wo count nahi hota
  (WhatsApp/Facebook group ke "seen" ka koi data bahar nahi milta).
- Bots aur admin ke visits count nahi hote (pehle jaisa).
- Group delete karne par us group ke ✓ hat jate hain; purane visit posts ke total mein rehte hain lekin group table se gayab.
