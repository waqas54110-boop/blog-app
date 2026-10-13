# V62: Ludo themes, dice / token skins, animations and sounds

Ludo ab apni shakal aur awaz badal sakta hai. Har khilari ka intikhab uske account mein save hota hai aur sirf uski apni screen par lagta hai.

## Naye / badle files
- Naye: `migration_v62.sql`, `SETUP_V62.md`
- Badle: `views/ludo-game.ejs` (themes, skins, effects, sound, style panel), `lib/ludo.js` (prefs save/load + migration), `routes/ludo.js` (`POST /ludo/prefs`, prefs page ke saath), `app.js` (prefs ka rate limit)
- Naya package ya `.env` setting **nahi** chahiye.

## Kya naya hai
- **Themes** (board ke rang, border, cells): Classic, Truck Art (phool-patti border, chamakte rang, phool wale safe cells aur beech mein phool), Neon (andhera board, chamakti lines), Dark.
- **Dice skins**: Classic, Gold, Casino, Neon, Truck Art.
- **Goti skins**: Round, Pawn, Gem, Star, Phool.
- **Style panel**: game page ke upar "🎨 Style" button. Har option ka chota preview dikhta hai.
- **Animations**: goti har kham par slide + chota bounce karti hai (aur doosri gotiyon ke upar rehti hai); capture par board hilta hai aur pakri hui goti ghoom kar chhoti hoti hai; 6 aane par confetti; goti ghar pahunche to chota confetti; jeetne par bada confetti.
- **Sounds**: dice ki khanak, goti ka tick, goti nikalna, capture, ghar pahunchna, 6 (chime), apni baari ki ding, jeet / haar. Sab browser mein WebAudio se banti hain, **koi mp3 file nahi chahiye**. 🔊 button upar bar mein hai (aur style panel mein "Sound effects" tick), mute bhi account mein save hota hai.
- Browser ka "reduce motion" setting on ho to shake aur confetti band rehte hain.

## Bug fix (purani zip mein)
`handRoll(final, done)` ka signature `triggerRoll()` ke call se mel nahi khata tha, is liye dice dabane par roll server tak jata hi nahi tha. Ab `handRoll(done)` hai aur roll hand animation ke baad bhej diya jata hai.

## Server setup
1. Files copy karein (ya poori zip).
2. `ludo_prefs` table server start par khud ban jati hai (`migration_v62.sql`). Na bane to Neon SQL Editor mein chala dein (dobara chalana safe hai).
3. Restart karein. Table na ho tab bhi game chalta hai, bas style yaad nahi rehta.

## Technical notes
- `ludo_prefs(user_id, theme, dice_skin, token_skin, sound)`. Server sirf wahi ids qabool karta hai jo `PREF_OPTIONS` (`lib/ludo.js`) mein hain; baaqi sab ignore.
- Naya theme / skin jodna ho: client side `THEMES`, `DICE_SKINS`, `TOKEN_SKINS` (`views/ludo-game.ejs`) aur server side `PREF_OPTIONS` (`lib/ludo.js`) dono mein id likhein.
- Awaaz pehli tap ke baad shuru hoti hai (browser ki pabandi). Tab chhupa ho to sirf "teri baari" ki ding bajti hai.
