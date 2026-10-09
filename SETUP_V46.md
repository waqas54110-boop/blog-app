# V46: Shop (multi-vendor) 🛍️

Aap apni shop bana sakte ho, aur doosre log bhi apni shop khol kar business shuru kar sakte hain.

## Ye zip CUMULATIVE hai
Is mein pehle se sab hai: V43 (Facebook signup wall), V44 (Facebook hook), V45 (Daily Rates) **aur** naya V46 (Shop).
`app.js`, `config.js`, `routes/posts.js`, `views/post.ejs`, `views/editor.ejs`, `views/partials/header.ejs` mein chaaron features ek saath jure hue hain, is liye sirf ye zip copy karo.

## Pehle SQL (Neon SQL Editor, is tarteeb se; dobara chalana safe)
1. `migration_v44.sql` (Facebook hook: agar pehle nahi chalai)
2. `migration_v45.sql` (rates_history)
3. `migration_v46.sql` (Shop). Ye server start par khud bhi chal jati hai.

## Setup
1. Files copy karo (naye: `lib/shop.js`, `routes/shop.js`, `routes/seller.js`, `migration_v46.sql`, naye views; badli hui: `app.js`, `config.js`, `lib/images.js`, `routes/posts.js`, `views/editor.ejs`, `views/post.ejs`, `views/partials/header.ejs`, `views/dashboard.ejs`).
2. `migration_v46.sql` server start par **khud chal jati hai** (dobara chalna safe). Na chale to Neon SQL Editor mein haath se chalao.
3. Deploy. Header mein 🛍️ Shop, aur login ke baad menu mein 🛍️ My Shop.

## Kahan kya hai
| Page | Kaam |
|---|---|
| `/shop` | sab shops ke products, search, category |
| `/shop/<shop>` | ek shop ka page |
| `/shop/<shop>/<product>` | product page: photos, qeemat, tafseel, stock, "Abhi order karo" |
| `/order/<token>` | customer ka order page (halat dekhne ke liye) |
| `/seller` | seller dashboard (naye orders, sale) |
| `/seller/products` | product daalna, qeemat/stock badalna, Sold out, chhupana |
| `/seller/orders` | orders; status: Naya / Bhej diya / Pahunch gaya / Wapas |
| `/seller/share` | har group ke liye alag UTM link (Group Poster jaisa) |
| `/seller/analytics` | group-wise: kitne log aaye, kitne orders, sale |
| `/admin/shops` | sab shops, manzoori / band karna (sirf admin) |

## Order
- **Cash on Delivery** aur **WhatsApp order** (order save hota hai, phir seller ke WhatsApp par tayyar message khulta hai).
- Order par stock khud kam hota hai (do log aakhri piece nahi le sakte). Stock 0 = "Sold out", form band.
- Status "Wapas" par stock wapas jur jata hai; Wapas ke baad status final hai.
- Seller ko in-app notification (+ email agar SMTP set ho). Login customer ko status badalne par notification.

## Group-wise sales
- `/seller/share` par groups daalo (`Naam | link`). Har group ka apna UTM banta hai.
- Product ka link `?utm_source=whatsapp&utm_medium=group&utm_campaign=<group-utm>` ke saath copy hota hai; "Next group" button caption copy + group open + ✓ karta hai.
- Customer ne 7 din ke andar order kiya to order us group ke naam jata hai.
- Admin: "Group Poster ke groups le aao" button wahi UTM copy karta hai, to purani analytics mil jati hai.

## Blog post mein product
Post editor mein "Product card" dropdown se product chuno: post ke neeche "🛍️ Ye product kharido" card aata hai. Is se aaye log aur orders `/seller/analytics` ke "Blog posts" hisse mein dikhte hain.

## Settings (.env, optional)
`SHOP_APPROVAL=1` (nayi shop manzoori ke baad public), `SHOP_ADMIN_ONLY=1`, `SHOP_MAX_PRODUCTS=200`.

## Baad mein (abhi nahi banaya)
Online payment (JazzCash / Easypaisa / card), discount code, product reviews, delivery tracking. Orders table mein `payment_method` pehle se hai, to payment baad mein asaani se judegi.

## Dhyan do
- Ek user ki ek shop. Seller sirf apne products/orders dekh sakta hai.
- Order spam: `/order` par rate limit, honeypot, aur 2 minute ka double-click bachao.
- Payment seller aur customer ke beech hai (COD); platform paisay nahi sambhalta.
