# V56: Shop upgrade 🛍️

## What's new
1. **Variants (color / size / type)**: on the product edit page the seller adds rows under "🎨 Variants" (Color, Size, Type, optional separate price, stock). Every variant has its own stock. The customer must pick an option first; sold-out options are disabled. For a product with variants, the main Stock field becomes the sum of its variants (kept in sync automatically).
2. **Coupons**: "🏷️ Coupons" in the seller menu. For example `TIKTOK10` = 10% off only for visitors who came from TikTok. Percent or flat amount, minimum order, usage limit, expiry date. Each coupon shows how many orders, how much sales and how much discount it produced. A coupon can also be pre-applied through a link: `/tp/PRODUCT_ID?coupon=TIKTOK10`, or add `?coupon=TIKTOK10` to a product or cart link.
3. **Cart**: "🛒 Add to cart" on the product page. On `/cart`: quantity, remove, coupon, delivery details and "✨ You may also like" suggestions. Items from different shops create a separate order per shop (with separate delivery). Everything runs in one transaction: if any item is sold out, no order is created.
4. **Automatic WhatsApp message after ordering**: as soon as an order is placed the customer receives "We received your order, it will arrive in 1-2 days"; when the order is shipped (or a tracking number is added) they get the tracking message. Each message type is sent only once per order. The seller's order card shows whether each message was sent; if not, a ready-made wa.me button lets the seller send it by hand.
5. **Courier + tracking number**: on the seller's order card, "📦 Enter courier and tracking number" (TCS, Leopards, M&P, Trax, PostEx, BlueEx, Call Courier, Pakistan Post, other). The order becomes "Shipped" and the customer's order page shows a "🔎 Track" button.
6. **Social proof (real counts only)**: the product page shows "👀 N people viewed today" (distinct visitors today; your own visits, admin visits and bots are excluded) and "🛒 N orders placed" (returned orders are excluded). If a count is below `PROOF_MIN_VIEWS` (default 3) / `PROOF_MIN_ORDERS` (default 1) the line is not shown at all. No fake numbers.

## Bonus (no new database table)
7. **Orders CSV / Excel export**: Seller > Orders > "⬇️ Excel / CSV download" (respects the status filter, up to 5000 orders).
8. **Packing slip / shipping label**: "🖨️ Slip" on each order card: name, phone, address, items, courier / tracking and, for COD orders, "COD: Rs ... to collect". Includes a Print button.
9. **Low-stock alert**: when an order brings a product (or variant) down to 3 or fewer, the seller gets a notification (only when stock crosses below 3, not on every order).
10. **Track my order** (`/track`): a customer can open their order page with the order number + phone number, no account needed. Rate-limited to stop guessing.

## Setup
1. Run `migration_v56.sql` in the Neon SQL Editor (it also runs by itself on server start; running it again is harmless). Old orders are copied into `order_items` automatically.
2. Copy the files and `git push`. No new packages.
3. Nothing is required in `.env`. Cart, coupons, variants, courier and social proof work without any setting.

## WhatsApp auto message (optional, Meta WhatsApp Cloud API)
On WhatsApp the first message to a customer can only be sent through a **template** approved by Meta. So:
1. In Meta Business create a WhatsApp Cloud API app and get a **permanent token** and the **Phone number ID**.
2. In `.env`: `WHATSAPP_TOKEN=...` and `WHATSAPP_PHONE_ID=...`
3. Create 2 templates in Meta (category: Utility, language = `WHATSAPP_TEMPLATE_LANG`, default `en`). Keep the variable order exactly as below:

   **order_received** (`WHATSAPP_TEMPLATE_PLACED`):
   ```
   Hello {{1}}! We received your order #{{3}} at {{2}}. Total: Rs {{4}}. It should reach you in {{5}}. Order status: {{6}}
   ```
   {{1}} customer name, {{2}} shop name, {{3}} order number, {{4}} total amount, {{5}} delivery time text (`ORDER_ETA_TEXT`, default "1-2 days"), {{6}} order page link.

   **order_dispatched** (`WHATSAPP_TEMPLATE_DISPATCHED`):
   ```
   Hello {{1}}! {{2}}: your order #{{3}} has been shipped. Courier: {{4}}, tracking number: {{5}}. Order status: {{6}}
   ```
   {{1}} customer name, {{2}} shop name, {{3}} order number, {{4}} courier, {{5}} tracking number, {{6}} link.
4. Once the templates are approved the automatic messages start working. If the settings are missing or a send fails, the order is still placed; the seller's order card shows a "💬 Send the ready message by hand" button.
5. `SITE_URL` must be set in `.env` so that links are complete.

## Courier tracking links (honest note)
Customers are sent to the **official tracking pages** of TCS and Leopards. No official "link with the number inside" pattern is confirmed for them, so when the customer taps "Track" the tracking number is copied automatically (they paste it on the page). If you have a direct link for a courier, add it in `.env` as `COURIER_TRACK_URLS` (example in `.env.example`).

## Files
New: `migration_v56.sql`, `lib/cart.js`, `lib/couriers.js`, `lib/whatsapp.js`, `routes/cart.js`, `views/shop-cart.ejs`, `views/shop-cart-done.ejs`, `views/seller-coupons.ejs`, `views/seller-slip.ejs`, `views/shop-track.ejs`, `SETUP_V56.md`
Changed: `app.js`, `config.js`, `.env.example`, `lib/shop.js`, `lib/reminders.js`, `routes/shop.js`, `routes/seller.js`, `views/shop-product.ejs`, `views/shop-order.ejs`, `views/seller-orders.ejs`, `views/seller-products.ejs`, `views/seller-product-form.ejs`, `views/partials/shop-style.ejs`, `views/partials/seller-nav.ejs`, `views/partials/header.ejs`
