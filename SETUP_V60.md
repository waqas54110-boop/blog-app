# V60: Ludo (/ludo)

Online multiplayer Ludo: alag alag phone se, 2 se 4 khilari, khali seat par bot. Room code ya WhatsApp link se dost join karte hain.

## Naye / badle files
- Naye: `migration_v60.sql`, `lib/ludo.js`, `routes/ludo.js`, `views/ludo.ejs` (lobby), `views/ludo-game.ejs` (board), `SETUP_V60.md`
- Badle: `app.js` (rate limits, JSON parser, poll route, router, schema), `views/partials/header.ejs` (menu mein "🎲 Ludo")
- Naya package ya `.env` setting **nahi** chahiye.

## Server setup
1. Files copy karein (`app.js` aur `header.ejs` ki jagah is zip wali copy, ya `PATCH_V60_ludo.diff` laga dein).
2. Migration server start par khud chal jati hai. Na chale to `migration_v60.sql` Neon SQL Editor mein chala dein (dobara chalana safe hai).
3. Restart karein, phir `/ludo` kholen.

## Kaise khelte hain
- **Create room**: 2 / 3 / 4 khilari chunein. "Open rooms list" tick karein to room sab ko lobby mein dikhta hai, warna sirf code / link se.
- **Invite**: room ke andar "Copy invite link" ya "Share on WhatsApp". Link kholte hi banda login ke baad khud join ho jata hai.
- **Host**: "Add bot" / "Fill with bots" / "Remove bot", phir "Start game" (kam az kam 2 khilari).
- **Rules**: 6 aane par goti nikalti hai; 6, capture ya ghar pahunchne par dobara baari; lagatar teen 6 par baari ja-ti hai; safe cells (rangeen start cells aur ★) par capture nahi; ghar mein pahunchne ke liye exact number. Pehla jo 4 goteyan ghar le aaye wo jeet gaya.
- **Timer**: har move ke liye 30 second. Waqt khatam ho to game khud chal deta hai; lagatar 3 baar chhootne par us seat par bot baith jata hai. Sab insaan chale jayein to game khatam.
- **Rematch**: game ke baad "Play again", baaqi khilari "Join rematch" dabate hain.
- **Leaderboard**: sirf un games ke wins ginti mein aate hain jin mein kam az kam 2 asal insaan thay (bots se akele khel kar farm nahi ho sakta).

## Technical notes
- Poora game server par tay hota hai (dice `crypto.randomInt`, legal moves, capture, timer), browser sirf `roll` / `move` bhejta hai, to cheating mumkin nahi.
- Browser har 1 se 2 second par `/ludo/:code/state.json` poll karta hai (aap ki baaqi site jaisa tareeqa). Ye route `app.js` mein page middleware se **pehle** laga hai, taake har poll par nav / ads wali database queries na chalein.
- Poll ka rate limit 300/minute per IP rakha hai kyunke mobile network par kai khilari ek IP share kar sakte hain. Zaroorat ho to `app.js` mein `/ludo/:code/state.json` wali line mein badal dein.
- Ek insaan ek waqt mein zyada se zyada 3 live games mein reh sakta hai (`MAX_ACTIVE` in `lib/ludo.js`).
- Safai: 3 ghante purane khali rooms, 20 minute se khamosh games aur 3 din purane khatam games khud hat jate hain.
- Table: `ludo_games` (state JSONB), `ludo_stats` (wins / played).
