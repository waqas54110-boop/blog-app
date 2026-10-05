# V29: Creators ki kamayi (views par) + manual withdraw (JazzCash / Easypaisa)

## Kaise kaam karta hai
1. User community feed mein post karta hai. Jab doosre log post dekhte hain, views barhte hain (pehle se hi chal raha hai).
2. **Har 100 views = Rs 1** (yani 1 view = 1 paisa). Ye views khud ba khud user ke wallet mein jama hote hain jab wo `/earnings` page kholta hai.
3. User `/earnings` par "Request withdrawal" dabata hai: JazzCash ya Easypaisa, number, naam, amount. Amount usi waqt wallet se kat kar "hold" ho jata hai.
4. Aap menu mein **Payouts** kholte hain, number dekhte hain, apni JazzCash / Easypaisa app se paisa bhejte hain, phir **Mark paid** dabate hain (transaction ID likh sakte hain). User ko notification jati hai.
5. Kisi wajah se na bhejna ho to **Reject** dabayein: paisa user ke balance mein wapas aa jata hai.

## Viewers paise nahi dete
Viewers ko kuch dena nahi parta. Kamayi ka paisa **aap ki jeb se** jata hai, is liye ye tabhi chalayein jab aap ke paas ads / sponsor ki asli income ho (ya aap ye kharcha khud uthane ko tayyar hon). Is code mein koi ad network (AdSense wagaira) nahi lagi, wo alag lagani hogi.

## Deploy ke steps
1. **migration_v29.sql** Neon SQL Editor mein run karein (deploy se PEHLE). Dobara run karna safe hai.
   - Purane views ka paisa nahi milta (kamayi aaj se). Purane views bhi ginne hon to migration mein `UPDATE feed_posts SET credited_views = views;` wali line hata kar run karein.
2. Files copy karein, `git push`. Koi nayi npm package nahi.
3. Railway Variables mein dalein (pehle sirf `EARN_ENABLED=1`, baqi default theek hain):

| Variable | Default | Matlab |
|---|---|---|
| `EARN_ENABLED` | band | `1` likhein to kamayi chalu. Jab tak ye nahi, `/earnings` par "abhi chalu nahi" likha aata hai |
| `EARN_PAISA_PER_VIEW` | `1` | 1 paisa = 100 views par Rs 1. `2` = 100 views par Rs 2 |
| `EARN_MIN_WITHDRAW_RS` | `500` | Kam az kam withdraw |
| `EARN_DAILY_CAP_RS` | `200` | Ek user roz ke zyada se zyada itna kama sakta hai. `0` = hadd nahi |

## Fraud se bachao (jo laga hai)
- Gine jane wale views wahi hain jo pehle se bots, admin aur post ke apne owner ko nikal dete hain.
- Sirf **email verified** user kamata hai. Admin nahi kamata.
- Roz ki hadd (`EARN_DAILY_CAP_RS`). Hadd ke baad us din ke views zaya.
- Hidden / spam post ke views nahi gine jate.
- Ek user ki ek waqt mein ek hi pending request. Double-click par paisa do baar nahi katta / bhejta.
- Aap har request haath se dekh kar paisa bhejte hain.

## Hadood (jo jan lein)
- **Views ka ek browser session mein dohrana rokna sirf browser ki taraf se hai.** Koi technical banda script se apne post ke views barha sakta hai. Is liye roz ki hadd aur manual approval rakhi hai. Kisi ka graph achanak 10 guna ho to Payouts mein paisa bhejne se pehle uski posts dekh lein.
- **Sirf feed posts** par kamayi hai. Blog ke articles aap ke apne hain, un par nahi.
- Kamayi `/earnings` page kholne par (ya withdraw karte waqt) wallet mein jama hoti hai, har view par live nahi.
- Rate ka hisab: Rs 1 / 100 views = **Rs 10 per 1000 views**. Apni asli ad income (RPM) se mila lein. Agar aap ko 1000 views par Rs 10 se kam milta hai to aap ghate mein hain, rate (`EARN_PAISA_PER_VIEW`) ya hadd kam rakhein.
- Agar aap Google AdSense istemal karein: users ko views / clicks par paisa dene se "invalid traffic" ka khatra barhta hai, aur AdSense ke qawaid mein ads dekhne ke badle inaam dena mana hai. Lagane se pehle AdSense ki taaza policy khud parh lein. Users ko kabhi ads par click karne ko na kahein.
- Tax / FBR / JazzCash business limits aap ki zimmedari hai. Bohat zyada payouts se pehle kisi account / tax mushir se poochh lein.
- Ye code asli Postgres par test hua hai (kamayi, hadd, withdraw, reject, ek saath kai requests). Asli site par pehle ek chhote test se dekhein: apne do accounts se post, view, withdraw, Mark paid.
