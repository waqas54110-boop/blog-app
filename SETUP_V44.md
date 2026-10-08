# V44 - Facebook Hook (share preview jo click karne par majboor kare)

Har post ke liye alag "Facebook hook": ek headline + description sirf share preview ke liye, aur ek naya share card
(dark card, bara headline, asli reads/comments ke numbers, hare rang ka "Read the full story >>" button).
Google wala title/SEO bilkul nahi badalta. Facebook wall (V43) is ke saath chalti hai: preview dekh kar click -> post -> signup.

## Pehle SQL chalao (Neon SQL Editor -> paste -> Run)
`migration_v44.sql` ka content paste karke Run karo. (Dobara chalane se koi nuqsan nahi.)
Jab tak SQL nahi chalta, site normal chalti rahegi; bas hook fields save nahi hongi.

## Files (same jagah replace/add karo)
- lib/card.js                 -> hookCardSvg + renderHookCard
- routes/growth.js            -> /og/<slug>.png: hook ho to naya card
- routes/posts.js             -> hook save (naya/edit), og:title / og:description / og:image
- views/partials/header.ejs   -> og:title / og:description / twitter:* hook se
- views/editor.ejs            -> "Facebook hook" box (2 fields)
- migration_v44.sql

## Deploy
    cd ~/Pictures/first_backup
    cp -r ~/Pictures/first/{views,routes,lib,migration_v44.sql,SETUP_V44.md} .
    git add . && git commit -m "V44: facebook hook share card" && git push

## Kaise use karna hai
1. Post likhte/edit karte waqt "Facebook hook" box mein:
   - headline (max 90 akshar): sawal, number, ya adhoori baat
   - description (max 200): ek line jo curiosity banaye
2. Save karo, phir link https://developers.facebook.com/tools/debug/ mein daal kar "Scrape Again" dabao
   (Facebook purani preview yaad rakhta hai; naya hook naye image URL ke saath aata hai).
3. Ab Facebook par link share karo: naya card + hook headline dikhega.

## Misaal
- Normal title:  "PTI long march ka ahem marhala"
- Hook:          "Long march Islamabad pohanch gaya: ab agla qadam kya hoga?"
- Description:   "Teesri baat sab se zyada hairan karne wali hai..."

## Zaroori usool
- Hook post ke asli content se milta ho. Misleading clickbait par Facebook reach kam kar deta hai
  aur log 3 second mein wapas chale jate hain (bounce), jis se aap ki site ko nuqsan hota hai.
- Card par numbers sirf asli aate hain: "reads" jab 100+ hon, "comments" jab 5+ hon. Kam hon to nahi dikhte.
- Hook khali chhodo to purana normal card/cover image hi chalta hai.
