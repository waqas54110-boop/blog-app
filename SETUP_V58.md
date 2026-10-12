# V58: Office devices (/admin/office)

Office network ke saare devices ki list: kitne computer/laptop, printer, camera, phone, router/switch/Wi-Fi, TV, server/NAS, aur baqi unknown. Sirf admin dekh sakta hai.

## Kaise kaam karta hai
Internet par baithi website office ka network nahi dekh sakti. Isliye ek chhota script (`scripts/office_scanner.py`) office ke andar kisi bhi computer par chalta hai, devices dhoondta hai, aur list site par bhej deta hai (ya file bana deta hai jo aap import kar dein).

## Setup
1. Naye files: `migration_v58.sql`, `lib/office.js`, `routes/office.js`, `views/admin-office.ejs`, `scripts/office_scanner.py`, `SETUP_V58.md`.
2. `app.js` mein badlav (is zip wali `app.js` copy kar dein): office routers ka require, `/office/ingest` ki rate-limit, JSON parsers (csrf se PEHLE), `officeAdmin` router, aur server start par `officeLib.ensureSchema()`.
3. Migration server start par khud chal jati hai. Na chale to `migration_v58.sql` Neon SQL Editor mein chala dein.
4. Automatic upload chahiye to server settings mein `OFFICE_SCAN_TOKEN` daalen (lambi secret, kam az kam 16 huroof), phir restart. Ye na ho to sirf file import chalega.

## Chalana (office ke kisi computer par, Python 3.7+)
```
python3 scripts/office_scanner.py --site "Main Office"
python3 scripts/office_scanner.py --site "Main Office" --upload https://YOUR-SITE/office/ingest --token YOUR_TOKEN
python3 scripts/office_scanner.py --demo            # bina scan ke namoona dekhne ke liye
```
Pehli baar ye MAC makers ki list (~5 MB) download karta hai. Sirf apne network (192.168.x.x / 10.x.x.x / 172.16-31.x.x) ko scan karta hai. Kisi ka password nahi try karta, login nahi karta. Sirf wo network scan karein jo aap ka ho ya jis ki ijazat ho.

Bina `--upload` ke `office_scan.json` ban jati hai: Admin > `/admin/office` > "Import a scan file".

## Admin page par kya milta hai
- Upar ginti ke cards: All devices, Computers/laptops, Printers, Cameras, Phones, Network, TV, Servers/NAS, Unknown. Card dabao to usi qisam ki list khulti hai.
- Poori list: type, naam, IP, MAC, maker, khule ports, room/note. Search aur type filter.
- **Edit**: galat guess theek karo (naam, type, room, note). Ye MAC se jud jata hai, agle scan mein bhi yaad rehta hai.
- **Pichle scan se muqabla**: kaun naya device aaya, kaun nazar nahi aaya.
- Scan history (har site ke akhri 30), scan delete, aur CSV download (Excel mein khulti hai).

## Zaroori baatein
- Type ek samajhdar andaza hai (MAC maker + open ports + naam). Phone ka random MAC ho ya device band ho to naam nahi milta. Edit se theek kar lein.
- Ek hi network ke 2 switch/VLAN hon to har subnet ke liye alag `--subnet` aur alag `--site` se chalayen.
- Scan upload ka rasta CSRF se bahar hai (token se pehchaan hoti hai), is liye token ko raaz rakhein.
