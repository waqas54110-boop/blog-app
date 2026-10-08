# V41 - Messages redesign + 3 new chat features

## Pehle SQL chalao (Neon SQL Editor -> paste -> Run)
`migration_v41.sql` ka poora content paste karke Run karo.
(Dobara chalane se koi nuqsan nahi.) Agar deploy pehle ho jaye aur SQL baad mein chalao,
to bhi chat toot-ta nahi: naye features SQL chalne ke baad khud on ho jate hain (~20 second mein).

## Files (same jagah replace karo)
- app.js                 -> sirf 1 naya line: app.use('/messages', express.json({ limit: '4kb' }));
- lib/messages.js        -> reply / reactions / unsend logic
- routes/messages.js     -> /react, /delete routes + reply support + poll mein reactions/deletes
- views/messages.ejs     -> naya chat list (search, All/Unread tabs)
- views/chat.ejs         -> naya chat screen
- migration_v41.sql

## Deploy
    cd ~/Pictures/first_backup
    cp -r ~/Pictures/first/{views,routes,lib,app.js,migration_v41.sql,SETUP_V41.md} .
    git status --short
    git add .
    git commit -m "V41: messages redesign, reply, reactions, unsend"
    git push

## Naye features
1. Reply to a message: message par hover (phone par tap) -> ↩. Bubble ke andar quote dikhta hai, quote par click = original par jump.
2. Emoji reactions: 😊 -> 👍 ❤️ 😂 😮 😢 🙏. Dobara wahi emoji = reaction hat jati hai. Samne wale ko notification.
3. Delete for everyone (unsend): apne message par 🗑. Photo/voice file bhi database se delete. Reported (open report) message delete nahi hota.
Bonus: emoji picker, clickable links, day separators (Today/Yesterday), typing dots, scroll-to-bottom button
with new-message count, send bina page reload, chat list mein search.
