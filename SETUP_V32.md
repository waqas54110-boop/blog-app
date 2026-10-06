# V32: Stylish Community Feed (sirf feed page, home page waisa hi)

Koi migration nahi chahiye. Files copy karein aur `git push`.

## Kya badla
- **Hero**: gradient + dot pattern wala bara banner. Logged-in user ko time ke hisab se greeting ("Good evening, name 👋"), "Share something" button (seedha composer par le jata hai). Logged-out ko "Join free" / "Log in". Desktop par do tairte hue glass cards.
- **Rang**: purple/indigo hat gaya. Ab wahi green accent (#0a6b4d) jo home page ka hai, saath amber / rose / teal ke chhote touches. Dark mode mein bhi theek.
- **Post cards**: bari rounded cards, hover par halka uthna, naye cards fade-up hote hain, photo andar se rounded (hover par "View" badge), gradient avatar ring.
- **Chhoti text post** (photo ke baghair, 120 characters tak) ab serif "quote card" ban jati hai.
- **Like / Comment / Share** buttons ke apne hover rang, like karne par heart pop.
- **Composer**: upar rangeen patti, green gradient "Post" button, photo / live buttons.
- **Tabs** (Everyone / Following / My Groups): segmented pill control.
- **Left sidebar**: profile card par cover banner. **Right sidebar**: chhote uppercase titles.
- **Stories**: naya conic-gradient ring, "Stories - gone in 24 hours" label.
- **Phone**: neeche daayen floating ✍️ button (composer nazar aaye to chhup jata hai).
- Page ka title ab English: "Community Feed | Khabzo" (pehle "aur" likha tha).
- `prefers-reduced-motion` walon ke liye animations band.

## Files
`views/feed.ejs`, `views/partials/feed-assets.ejs`, `views/partials/feed-card.ejs`, `views/partials/stories-tray.ejs`, `routes/feed.js` (sirf title ki ek line).

## Dhyan dein
- `feed-assets.ejs` group pages aur single post page (`/feed/:id`) par bhi use hota hai, isliye wahan ke cards bhi naye style mein dikhenge. Logic kahin nahi badla, sirf CSS aur kuch class names.
- Home page (`views/home.ejs`, `routes/home.js`) ko haath nahi lagaya. Us ke title mein abhi "aur" likha hai (`routes/home.js` line ~107).
- Header aur footer shared hain, unhe nahi badla.
