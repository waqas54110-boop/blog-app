# V33: Stylish Blog page (/blog)

Koi migration nahi chahiye. Files copy karein aur `git push`. Route (`routes/posts.js`) aur data waisa hi hai.

## Kya badla
- **Hero**: gradient + dot pattern wala banner, serif heading "Cricket, Code, *Creativity & AI*", articles ki ginti, bari glass search bar, aur neeche rangeen category chips (scroll hote hain, phone par bhi).
- **Latest story**: pehle page par (filter ke baghair) sab se nayi post bari horizontal card mein.
- **Post cards**: category ka apna rang (home page ke saath bilkul wahi rang), upar rangeen patti, hover par uthna + image zoom, serif title/excerpt, tags, author, padhne ka waqt / views / likes / comments. Cover na ho to category ke rang ka gradient aur bara pehla harf.
- Posts ki ginti toot ho to aakhri card poori chaurai mein aati hai (khali jagah nahi rehti).
- **Sidebar**: author card cover banner ke saath, "Popular Posts" bade numbers ke saath, rangeen Categories list (counts), Tags cloud.
- **Pagination**: gol pills, active page par green gradient.
- Search / category / tag ka "N results ... Clear filters" bar naye style mein. Empty state bhi.
- Dark mode, phone aur `prefers-reduced-motion` teeno ka khayal rakha.

## Files
`views/index.ejs`, `views/partials/blog-card.ejs` (nai file).

## Dhyan dein
- Live contest ka block (agar chal raha ho) pehle jaisa hi hai, bas card rounded ho gaya.
- Home page, feed, header aur footer ko haath nahi lagaya. Single post page (`/posts/<slug>`) abhi purane style mein hai.
