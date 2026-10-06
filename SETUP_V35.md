# V35: Mohalla Cricket Manager + live stream score bar + category headlines bar

## Deploy se PEHLE
1. `migration_v35.sql` ko Neon SQL Editor mein ek baar run karein (dobara run karna safe hai).
2. Code deploy karein. Koi nayi npm package ya .env setting nahi chahiye.

## Mohalla Cricket Manager (/cricket)
- Navbar mein "🏏 Mohalla Cricket" aur menu (☰) mein "Mohalla Cricket Manager".
- Login user tournament banata hai (naam, shehar, overs) -> teams aur players add karta hai (naam comma ya nayi line se) -> fixtures
  (ek ek karke ya "Auto-create all fixtures" = har team ek dusre se ek baar) -> har fixture par "Start scoring".
- Scorer page (/cricket/m/ID/score, phone ke liye bana): toss -> striker / non-striker / bowler chuno -> run button (0-6) dabao.
  Wide, No ball, Bye, Leg bye aur Wicket (bowled, caught, lbw, run out, stumped, hit wicket) ke toggle. "Undo last ball" hamesha hai.
  Strike khud badalti hai (odd runs, over ka end), wicket ke baad naya batter aur over ke baad naya bowler maanga jata hai.
  Innings khatam hone par "Start 2nd innings"; chase mein target, need, RRR aur natija (won by N wickets / runs / tied) khud banta hai.
- Public live scorecard: /cricket/m/ID (login ki zaroorat nahi, har 4 second khud update). "Share on WhatsApp" button link bhej deta hai.
- Points table (jeet = 2, tie = 1) tournament page par. Player career: /cricket/p/ID (runs, balls, SR, average, highest, 4s/6s, 50s/100s,
  wickets, overs, economy, best figures). Career ek organizer ke saare tournaments ki balls jodta hai (player naam se pehchana jata hai).
- Dost se score karwana ho to scorer page par "Let a friend score" mein uska username likhein.

## Live stream par cricket score bar (boolean)
- Scorer page par switch: **"Show score bar on my live stream"** (`cricket_matches.show_on_stream`, default OFF).
- ON ho aur organizer isi waqt 🔴 Live ho to host ki screen aur har viewer ki live screen par TV jaisi score bar aati hai:
  team, runs/wickets, overs, CRR, striker / non-striker, bowler, "this over" ki gendein, chase mein "need X from Y balls | RRR | Target".
  Har ball par runs badalte hain to bar khud update hoti hai (runs par hara flash, wicket par laal flash).
- OFF ho, ya match live na ho, ya stream na chal rahi ho to bar nazar nahi aati. Match khatam hone ke 10 minute tak natija bar mein rehta hai.
- Stream ke ilawa kisi aur page par score bar nahi aati; wahan headlines bar hoti hai (neeche).

## Headlines bar (har page par, category ke hisab se)
- Navbar ke neeche chalti hui headlines. Bar ke laal hisse mein category dropdown hai ("Latest: All", Cricket, Tech ...). Select karte hi
  usi category ki headlines aa jati hain (bina page reload) aur choice cookie (`kz_cat`) mein yaad rehti hai.
- Agar user ne kuch select nahi kiya to blog category page / post page par us post ki category ki headlines aati hain, warna sab ki.
- Home page ki purani "Latest" patti hata di (ab yehi bar har page par hai). Scorer page par bar chhupi rehti hai.

## Nayi files
migration_v35.sql, lib/cricket.js, lib/headlines.js, routes/cricket.js, routes/headlines.js,
views/cricket.ejs, cricket-tournament.ejs, cricket-match.ejs, cricket-score.ejs, cricket-player.ejs,
views/partials/{cricket-assets,cricket-board,news-bar}.ejs

## Badli hui files
app.js (routes, rate limits, JSON body, headlines middleware), views/partials/header.ejs (nav + menu + bar), views/partials/live-ui.ejs (score bar),
views/home.ejs (purani ticker hata di), routes/posts.js (sitemap + robots)

## Dhyan dein
- /cricket pages ke liye migration_v35 na chali ho to 503 "needs migration" page aata hai, baqi site chalti rehti hai.
- Score bar ke liye live ka migration_v27 chala hona zaroori hai (live_streams table).
- Bohat viewers par server score ko 2 second cache karta hai, is liye 200 viewers bhi database par bojh nahi dalte.
