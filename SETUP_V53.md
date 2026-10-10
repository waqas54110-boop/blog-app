# V53: 2-person funny chat TikTok video (shop products) 🎭

Koi SQL migration nahi. Naya package nahi.

## Kya naya hai
Shop > My products > 🎬 TikTok video page par naya style: **2-person funny chat**.
- Do log (A aur B) speech bubbles mein baat karte hain, product dikhate hain.
- Movement script ke hisaab se: show (product bada), shock (hilna + ❗), laugh, cry (💧), price (price sticker), buy (💸), run (bhaag jana), point, dance.
- Prompt likho (jaise "dost late aata hai, ghari dikhao, hairan ho, bhaag jaye") aur **Make script** dabao. Product ghari ho to ghari wali funny script banti hai, warna general.
- Script khud edit kar sakte ho. Format: `A: text [action]` / `B: text [action]`. Action na likho to text se khud chuna jata hai.
- English ya Roman Urdu script, aur dono characters ka emoji chunne ka option.
- Funny sounds har line ke action ke saath khud bajti hain. Purana "Classic product video" style dropdown se wapas mil jata hai.

## Note
Script banana rule-based (templates + prompt ke keywords) hai, AI nahi. Isliye prompt mein ye lafz kaam karte hain: dance/nach, sasta/discount, funny/hans.

## Files
Badli: `views/shop-tiktok.ejs`   Naya: `SETUP_V53.md`
Istemal: file copy karo, git push, product ka TikTok video page kholo, Create video dabao.
