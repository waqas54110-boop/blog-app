# V31: Akhbar jaisa home page + naya navbar

Koi migration nahi chahiye. Files copy karein aur `git push`.

## Kya badla
- **Home page ("/")** ab akhbar ka pehla safha hai:
  - upar chalti hui "Latest" headlines ki patti;
  - auto-chalne wala **Top stories slider** (cover wali 3-4 naye posts; pause / aage / peeche button, neeche progress patti, phone par ungli se swipe);
  - 2 chhoti khabrein, "Most read" ki sticky list (pichle 30 din), "More stories" ki scroll patti;
  - 3 sab se bari categories ke sections. Har category ka apna rang hai (naam se hamesha wahi rang aata hai).
  - Live contest (agar chal raha ho) upar nazar aata hai.
- **Community feed** apni jagah wahi hai, bas ab `/?tab=all` par hai. Navbar mein naya "Feed" link hai. Feed ke andar ke links (Everyone, Back to feed) aur "My Posts" theek kiye gaye hain.
- **Navbar** ab akhbar jaisa hai: bara gradient "Khabzo" masthead (aaj ki tareekh ke saath) + search, phir sticky glass-style category patti (Home, Feed, Blog, aur aap ki saari categories). Patti ke daayen taraf: dark mode, notifications, messages, account menu (admin ke saare links waise hi), aur ☰ menu (Community, Groups, Leaderboard, Vote, Hire Me, About).
- Slider mein pehle wo posts aate hain jin par cover image ho. Cover na ho to category ke pehle harf wala rangeen block dikhta hai.
- `/blog` page waisa hi hai (poori list, filters, pagination).

## Dhyan dein
- Tracking wale links jaise `/?utm_source=...` ya `?fbclid=...` ab home page kholte hain. Feed sirf `tab`, `user`, `before`, `partial`, `posted`, `err`, `notice`, `deleted`, `reported` par chalti hai.
- Fonts (Newsreader, Archivo) Google Fonts se aate hain. Na aayen to Georgia / system font lag jata hai.
- Home page aur navbar ke saare labels English mein hain ("Most read", "2 hours ago", "View all posts").
