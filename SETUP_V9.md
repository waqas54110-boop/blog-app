# V9: Contest ko aur taqatwar banana

Naya kya hai (aap ki list ke number 9 se 12):

| # | Feature | Kahan dikhta hai |
|---|---------|------------------|
| 9 | **Post ke andar vote widget** | Editor mein "Vote contest" dropdown. Chuna hua contest post ke neeche, comments se pehle nazar aata hai |
| 10 | **Analytics mein votes** | `/analytics` ke neeche "🗳️ Vote contests": kitne ne kholay, kitne alag log, kitne ne vote diya, WhatsApp se kitne aaye/vote diya, share clicks |
| 10 | **Vote ke baad share-card** | Vote dete hi "I voted for X 🗳️" card + abhi ka result (62% vs 38%) + WhatsApp / Facebook / Copy link |
| 10 | **Countdown + live counting** | "2 days 4 hrs left" ticking countdown, aur vote par page refresh ke bagair percentage badalna (dusron ke votes bhi har 10 sec mein) |
| 11 | **Contest par comments** | Contest page ke neeche, replies + notifications ke sath (post comments jaisa) |
| 12 | **2 se zyada options / knockout** | Vote: 2 se 6 options. Knockout: 4 ya 8 naam, har round ka jeetne wala aage |

## Deploy ke qadam (is tarteeb se)
1. **Database (deploy se PEHLE):** `migration_v9.sql` Neon SQL Editor mein paste karke Run karein.
   (`migration_v8.sql` pehle chal chuki honi chahiye. V9 dobara run karna safe hai. Purane V8 contests aur unke votes khud nayi table mein copy ho jate hain.)
2. `git add -A && git commit -m "V9 contests" && git push origin main`

Koi nayi npm package nahi.

## Istemal

**Naya contest:** 🗳️ Vote -> New contest.
- *Vote*: 2 se 6 options (Add option button), har ki image, (optional) end time. Readers ko countdown nazar aata hai.
- *Knockout*: 4 ya 8 naam. Bracket isi tarteeb se banta hai: 1 vs 2, 3 vs 4, ... "Each round lasts (hours)" mein number likhein to har round itne ghante baad **khud** khatam hoga (server har minute check karta hai) aur jeetne wale agle round mein jayenge. Khali chhorein to contest page par "⏭ End this round now" dabayein.
- Match barabar rahe to bracket mein pehle likha hua naam aage jata hai.
- Knockout mein reader har match mein alag vote deta hai; purane rounds ke natije "results" mein khul kar dekhe ja sakte hain. Aakhir mein 🏆 Champion nazar aata hai.

**Post mein contest lagana:** Post edit karein -> "Vote contest" dropdown -> contest chunein -> Save. Widget mein readers wahin vote kar sakte hain (guest ko login ke baad usi post par wapas la kar vote laga diya jata hai). Hatane ke liye dropdown "No contest" par karein.

**Vote ke baad share-card:** Vote dete hi neeche card aati hai. WhatsApp/Facebook par jo link jata hai us ki preview mein bhi wahi "I voted for X + result" wali image nazar aati hai. (Facebook/WhatsApp purani preview cache kar lete hain.)

**Analytics:** `/analytics` (7/30/90 din). 
- *Opened* = contest page ya post widget khula. *People* = alag browsers (ek chhoti cookie se). 
- *Voted from WhatsApp*: jin ka contest link WhatsApp share se aaya. Share buttons link mein `utm_source=whatsapp` lagate hain, is liye pehchan pakki hai. Bots aur admin ke visits count nahi hote.
- Purane (V8 ke waqt ke) votes ka source nahi hota, wo "direct" ginay jate hain.

## Notes
- Text badalna ho (jaise "I voted for" ko "Maine ... ko vote diya") to `views/partials/poll-script.ejs` ke shuru mein `T = {...}` dekhein.
- Share-card image server par `sharp` se banti hai (pehle jaisa). `sharp` na chale to card image band, baaqi sab chalta hai.
- Live counting har 10 sec mein sirf tab poll karti hai jab tab nazar aa raha ho, aur ek page par max 30 minute.
- Comments sirf `poll_comments` table mein hain, post comments ko koi asar nahi.
