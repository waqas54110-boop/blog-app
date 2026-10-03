# V22: Group chat, private groups, DM photo + voice, typing, seen

Naya package koi nahi (npm install ki zaroorat nahi).

1. Neon SQL Editor mein `migration_v22.sql` run karo (deploy se PEHLE). Dobara run karna safe hai.
2. `git push` se deploy karo.

## Kya naya hai

**Group chat**: har group ke page par **💬 Chat** button (sirf members ko). Messages sirf members dekhte hain.
Apna message ya group admin / site admin kisi ka bhi message delete kar sakta hai. Block kiye hue user ke messages nazar nahi aate.

**Private groups**: group banate waqt "Who can join?" mein *Private* chuno (ya owner baad mein **⚙️ Manage** se badle).
- Non-member ko sirf naam, description aur member ginti dikhti hai, plus **Request to join**.
- Posts, chat aur members sirf members (aur site admin) dekhte hain. Private group ki post ka link, like aur comment bhi sirf members ke liye.
- Admin ko **⚙️ Manage** page: join requests (Approve / Decline), apne friends ko seedha add karna, member hatana, privacy badalna.
- Private group mein invite link sirf admin ko dikhta hai. Jis ke paas link ho wo seedha join ho jata hai (request ke baghair), isliye zyada phail jaye to **Reset invite link**.

**Private messages**: 📷 photo, 🎤 voice message (max 2 minute), "X is typing…", aur bheje hue message par ✓ (sent) / ✓✓ neela (seen).
Photo / voice sirf chat ke do logon ko khulti hai (`/messages/media/ID` login + is chat ka member hona chahiye). Mic ke liye HTTPS aur browser ki microphone permission chahiye (Railway par HTTPS hai, localhost par bhi chalta hai).

**Typing** group chat mein bhi kaam karta hai.

## Hadood (jaan boojh kar)
- Group chat sirf text hai (photo / voice abhi sirf private messages mein).
- Group chat mein "seen" nahi aur naye message par notification / unread badge nahi.
- Chat polling se chalti hai (har 3 second), WebSocket nahi: typing / naya message 1 se 3 second late dikhta hai.
- Photo / voice database mein save hote hain (Neon ki jagah kheti hai). Bahut chat ho to storage dekhte rehna.
- Private group ki post ki photo `/img/ID` par hai, jo purani feed photos jaisi hi hai: link/ID maloom ho to khul jati hai. Posts khud members ke ilawa nahi dikhtin.
- Reported photo / voice ko site admin sirf us waqt sunta/dekhta hai jab us message par open report ho.
