# V30: Blog parhne ka inaam + invite ka inaam

## Naye qawaid
1. **Parhna:** login + email verified user kisi blog post par **60 seconds** (tab khula ho, scroll / tap kar raha ho) rahe to **Rs 0.05**. **Har post par sirf ek baar** (database mein UNIQUE hai). Roz ki hadd Rs 10.
2. **Invite:** dost aap ke `/invite` link se aaye, email verify kare aur vote / prediction / comment mein se ek kaam kare (wahi purana "qualified" qaida) to **Rs 1** ya har dost par. 10 dost = Rs 10. Zyada se zyada 100 dost.
3. **Apni feed posts ke views:** pehle jaisa, 100 views = Rs 1.

Teeno ka paisa ek hi wallet mein jata hai, aur withdraw pehle jaisa (JazzCash / Easypaisa, manual).

## Deploy ke steps
1. Neon SQL Editor mein **migration_v29.sql** (agar nahi chali) aur phir **migration_v30.sql** run karein, deploy se PEHLE.
2. Files copy karein, `git push`.
3. Railway Variables mein **`EARN_ENABLED=1`** likhein (iske baghair `/earnings` par "not switched on yet" aata hai). Redeploy hone ka intezar karein.

## Settings (sab optional)
| Variable | Default | Matlab |
|---|---|---|
| `EARN_READ_SECONDS` | 60 | Post par kitne seconds (kam az kam 20) |
| `EARN_READ_PAISA` | 5 | Ek post ke paisa (5 = Rs 0.05) |
| `EARN_READ_DAILY_CAP_RS` | 10 | Parhne se roz ki hadd |
| `EARN_INVITE_PAISA` | 100 | Ek dost ke paisa (100 = Rs 1) |
| `EARN_INVITE_MAX` | 100 | Zyada se zyada kitne doston ka |

## Kaise kaam karta hai
- Post page khulte hi **server** session mein waqt likhta hai. Browser ka timer sirf dikhawa aur trigger hai: server tabhi paisa deta hai jab waqai 57+ seconds guzar chuke hon. Seedha API bula kar jaldi paisa nahi milta.
- Timer tab ruk jata hai jab tab chhup jaye ya 15 second koi scroll / tap / click na ho.
- Invite ka paisa `/earnings` kholne par (ya withdraw par) jama hota hai, aur user ko notification milti hai.

## Hadood (jo jan lein)
- **Ye paisa aap ki jeb se jata hai.** Parhne wale ko Rs 0.05 per post = Rs 50 per 1000 post-reads. Ads ki asli income isse kam ho to aap ghate mein hain. Pehle apni asli per-view ad income dekhein, phir `EARN_READ_PAISA` rakhein.
- **Kul nuqsan ki hadd:** parhne ka inaam har post par ek baar hai, is liye ek user zindagi mein zyada se zyada (post ki tadaad × Rs 0.05) kama sakta hai. Roz Rs 10 ki hadd alag.
- **Script se dhoka mumkin hai:** koi banda 60 second intezar kar ke script se request bhej sakta hai. Rok-tham: email verify, roz ki hadd, har post ek baar, aur aap har payout haath se dekhte hain. Naye accounts se ek ke baad ek aate hue kai kamaane walay dikhein to payout rok dein.
- **Fake invites:** dost ko email verify karna aur ek kaam karna parta hai, magar ek banda kai email bana kar ye kar sakta hai. Max 100 dost ki hadd hai. Rs 1 ya dost bohat zyada ho to `EARN_INVITE_PAISA` kam karein.
- **AdSense:** users ko ads wale page par parhne ka paisa dena AdSense ki "invalid traffic" policy ke khilaf samjha ja sakta hai. Ads lagane se pehle unki taaza policy parh lein, aur users ko ads par click karne ka na kahein.
- Ye code asli Postgres par test hua hai (60 sec qaida, ek post ek baar, ek saath kai requests, roz ki hadd, invite ki hadd). Asli site par apne do accounts se ek chhota test zaroor karein.
