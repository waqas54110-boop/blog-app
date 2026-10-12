# V59: Office monitor (/admin/office)

V58 ki list ab "zinda" ho gayi: kaun online hai, kaun slow, kaun offline; network ke masle; khule ports ki warning; aur Telegram alerts.

## Naye / badle files
- Naye: `migration_v59.sql`, `lib/officemon.js`, `SETUP_V59.md`
- Badle: `lib/office.js` (V59 migration bhi chalati hai), `routes/office.js`, `views/admin-office.ejs`, `app.js`, `scripts/office_scanner.py` (v1.1)
- `app.js` aur `routes/office.js` ki jagah is zip wali copy kar dein (ya diff dekh kar apni file mein laga dein).

## Server setup
1. Migration server start par khud chal jati hai. Na chale to `migration_v59.sql` Neon SQL Editor mein chala dein (pehle `migration_v58.sql` chali hui honi chahiye).
2. `OFFICE_SCAN_TOKEN` pehle se set hona chahiye (V58 wala, 16+ huroof). Wahi token monitor bhi istemal karta hai.
3. Alerts ke liye server settings mein `OFFICE_TELEGRAM_CHAT_ID` daalen, phir restart. `TELEGRAM_BOT_TOKEN` pehle se hai.
   - Ye apna **private** chat ya group ho (bot ko wahan message karne ki ijazat ho). Office ki maloomat public channel mein nahi jani chahiye, isliye agar ye `TELEGRAM_CHAT_ID` (public channel) ke barabar hui to alerts band rehte hain.
   - Chat id maloom karne ke liye bot ko message bhej kar `https://api.telegram.org/bot<TOKEN>/getUpdates` kholen; `chat` > `id` wo number hai.
   - Page par "Send test alert" se check kar lein.

## Office ke computer par (jo hamesha chalta rahe)
1. Pehle normal scan karke import karein (monitor isi list ko "umeed" ki list maanta hai). Port warnings ke liye **naya scan zaroori hai**: scanner ab ports 21, 23, 5900 bhi dekhta hai.
2. Monitor chalayen (`--site` ka naam scan wala hi ho):
```
python3 scripts/office_scanner.py --monitor --site "Main Office" --upload https://YOUR-SITE/office/ingest --token YOUR_TOKEN --yes
```
3. Doosra DHCP server dhoondne ke liye (administrator / sudo chahiye, kyunki port 68 sunna parta hai):
```
sudo python3 scripts/office_scanner.py --monitor --dhcp-check --site "Main Office" --upload https://YOUR-SITE/office/ingest --token YOUR_TOKEN --yes
```
Options: `--every 300` (har kitne second, 60-3600), `--dhcp-every 12` (har 12 round par, yani ghante mein ek baar), `--heartbeat URL` (agar `--upload` na dena ho).
Ye computer band ho jaye to site 12 minute baad Telegram par "monitor chup ho gaya" bata deti hai.
Windows par Task Scheduler / Linux par systemd ya `@reboot` cron se start-up par chalwa sakte hain.

## Page par kya milta hai
- **Status column**: hara = Online, peela = Slow (150 ms se zyada), laal = Offline (kitni der se). Phone ka jana normal hai, isliye wo gray "Away" dikhta hai. Saath mein pichle 24 ghante ka uptime % aur kitni baar drop hua.
- **Last 24 hours**: jo devices girte rahe unki list ("kal 3 baar offline hua").
- **Network problems**: IP conflict (ek IP par do MAC), 169.254 wale devices (router se IP nahi mila), doosra DHCP server / rogue router. Har masle ke saath hal likha hai.
- **Devices not in your last scan**: naye anjaan devices. "It is mine" dabane se list se hat jate hain.
- **Security hints**: khule ports se andaza: Telnet, FTP, VNC, Remote Desktop, camera ke recorder ports, NAS ka plain-HTTP admin page, "first-time setup" wala page. Har hint ke saath Fix likha hai.

## Telegram alerts kab aate hain
- Printer, camera, server/NAS ya router/switch lagatar 2 check (~10 minute) nahi mila -> OFFLINE. Wapas aaye to "Back online".
- Computer aur phone par alert nahi (wo raat ko band hote hain).
- Naya anjaan device network par aaya (monitor ki pehli report mein jo dikhe, uska alert nahi).
- Naya network masla (IP conflict, 169.254, doosra DHCP server).
- Monitor khud chup ho gaya / wapas aaya.
Ek round ke saare alerts ek hi message mein aate hain (zyada se zyada 12 lines).

## Zaroori baatein
- Monitor sirf ping + ARP + TCP "dastak" se dekhta hai. Kisi device mein login nahi karta aur password nahi aazmata. Security hints sirf ports se andaza hain: default ya kamzor password ye nahi pakad sakta.
- IP conflict ka pata ek ghante mein ek IP par MAC do baar badalne se lagta hai, isliye alert mein thori der lag sakti hai.
- Ping history 3 din rakhi jati hai; 24 ghante ki report usi se banti hai.
- Agar `migration_v59.sql` na chali ho to page pehle ki tarah chalta hai (bina status ke), crash nahi hota.
- Sirf wo network monitor karein jo aap ka ho ya jis ki ijazat ho.
