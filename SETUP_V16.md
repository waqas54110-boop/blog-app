# V16: Mutual friends + "People you may know"

| Feature | Kahan dikhta hai |
|---------|------------------|
| **Mutual friends (profile)** | Kisi aur ki profile par naam ke neeche **"👥 3 mutual friends: ali, omar, sara"** (pehle 3 naam, baqi "and N more"). Naam par click se unki profile khulti hai |
| **People you may know** | `/friends?tab=people` ke sab se upar. Doston ke dost, jin ke zyada mutual friends hon wo pehle (max 8). Sath hi **➕ Add friend** button |
| **People list** | Har row mein "👥 N mutual friends". List ab mutual friends ke hisab se sort hoti hai (zyada mutual pehle), phir naye members |
| **Requests tab** | Aayi hui request par bhi "👥 N mutual friends" dikhta hai, taake accept karna aasan ho |

## Qaaide
- Mutual friend = wo user jo aap ka bhi accepted friend hai aur samne wale ka bhi.
- Suggestions mein ye log **nahi** aate: jin se pehle koi bhi request (bheji, aayi, ya accepted) hai, jin se block hai (dono taraf), aur aap khud.
- Block karte hi dosti khatam ho jati hai, is liye blocked log kabhi mutual friends mein nahi ginay jate.
- Search (`q=`) karte waqt "People you may know" nahi dikhta, sirf search result dikhte hain (mutual count wahan bhi dikhta hai).
- Jis ka koi friend nahi, us ke liye suggestions khali rehte hain aur sirf "People" list dikhti hai.

## Deploy ke qadam
1. **Database migration ki zaroorat NAHI.** Koi nayi table/column nahi (sirf purani `friend_requests` aur `user_blocks`).
2. `git add -A && git commit -m "V16 mutual friends + people you may know" && git push origin main`

Koi nayi npm package nahi. Koi naya environment variable nahi.

## Badalne wali files
`lib/friends.js` (suggestions, mutualFriends, people/incoming mein mutual count), `routes/friends.js`, `routes/profile.js`, `views/friends.ejs`, `views/profile.ejs`, naya `views/partials/person-row.ejs`.
