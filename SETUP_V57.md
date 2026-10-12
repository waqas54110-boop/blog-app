# V57: IP Checker (/ip-check)

Bilkul alag (standalone) tool. Koi purana feature, table ya page change nahi hua. Migration ki zaroorat nahi.

## Kya karta hai
Ek input box mein IP likho, aur page batata hai:

**Public IP (jaise 8.8.8.8)**
- Country, city, ISP, ASN, time zone, reverse DNS.
- Connection type: Mobile data (SIM) / Home-office broadband (Wi-Fi router) / Data-center server / VPN-Proxy-Tor.
- **Real ya fake**: VPN, proxy, Tor ya server IP ho to "Hidden / server" likhta hai, warna "Looks real".
- Kaun si device: honest jawab. Public IP router / SIM / VPN server ka hota hai, laptop ka naam aur model **koi website nahi bata sakti**.

**Private / Wi-Fi IP (192.168.x.x, 10.x.x.x, 172.16-31.x.x)**
- Internet par lookup nahi hota (ye sirf us network ke andar hota hai), page seedha samjhata hai.
- Device ka naam kaise nikalna hai: router ka "connected devices" page, `arp -a`, `ping -a`, device ki About screen.
- **Wi-Fi problem check**: 169.254.x.x (router se IP nahi mili, DHCP fail) = "Problem found" + 7 fixes. 100.64.x.x (CGNAT) = limitation + hal. 0.0.0.0 = adapter ko address nahi mila. 127.0.0.1 = ye wohi computer hai.

**Apni connection ka live test** (har page par neeche)
- 12 ping (average, jitter, packet loss) + download speed. Result ke saath problem + solve karne ke steps (router restart, 5 GHz, channel, LAN cable test, ISP ko call...).
- Aap ki device: OS, browser, aur Android par model code (agar browser deta ho).

**MAC address se maker**: router ki list se MAC paste karo, Dell / Apple / Intel / TP-Link jaisa brand milta hai. Phones ka random MAC pehchan leta hai.

## Setup
1. Naye files copy karo: `lib/ipcheck.js`, `routes/ipcheck.js`, `views/ip-check.ejs`, `SETUP_V57.md`.
2. `app.js` mein sirf 5 nayi lines judi hain (is zip wala `app.js` copy kar do, ya haath se):
   - `const ipcheckRouter = require('./routes/ipcheck');`  (ratesRouter wali line ke baad)
   - 3 rate-limit lines `/ip-check`, `/ip-check/ping`, `/ip-check/blob` (`/trends` wali limiter line ke baad)
   - `app.use('/', ipcheckRouter);`  (`app.use('/', ratesRouter);` ke baad)
3. `git push`. Koi naya package nahi, `.env` mein kuch zaroori nahi.

## .env (sab optional)
- `IPAPI_KEY`: wohi ipapi.is key jo `lib/ipinfo.js` use karta hai. Na ho to free limit (~1000 lookups/din) lagti hai.
- `IPCHECK_DAILY_MAX=400`: is tool ke live lookups ki din ki hadd (cached repeat count nahi hote; ek IP 1 ghante tak cache rehta hai).
- `IPCHECK_PROVIDER=off`: internet lookup band; sirf private / Wi-Fi address wali checks chalti hain.

## Lookup fail ho to
Pehle `ipapi.is` try hota hai, fail ho to backup `ipwho.is` (is mein VPN / server / mobile ISP ke naam se andaza hota hai, aur page par likha aata hai). Dono fail hon to page par "Technical reason" dikhta hai aur server log mein `ip-check lookup failed` aata hai. `lib/ipinfo.js` (visitor analytics) bhi ipapi.is ka wohi free quota use karta hai, isliye `IPAPI_KEY` lagana behtar hai.

## Dhyan rakhein
- "Real / fake" ek public database ke flags par hai. Bilkul naya VPN miss ho sakta hai, isliye page "Looks real (not known to be hidden)" likhta hai, "100% real" nahi.
- Live test ka ping aap ki site ke server tak ka hai. Pakistan se Railway / Render tak 150-300 ms normal hai; Wi-Fi ki sehat jitter aur packet loss se samajh aati hai.
- Result pages `noindex` hain (Google har checked IP ko index na kare).
- Navbar mein "🔎 IP Checker" link `views/partials/header.ejs` mein add hai (Rates ke baad).

## Files
New: `lib/ipcheck.js`, `routes/ipcheck.js`, `views/ip-check.ejs`, `SETUP_V57.md`
Changed: `app.js` (sirf 5 lines add hui), `views/partials/header.ejs` (navbar mein 1 line: "🔎 IP Checker")
