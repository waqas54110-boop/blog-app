# V39: Advertise on Khabzo

Sell ad space on your own site. Five packages, one dashboard for advertisers, one admin page for you.

## What advertisers can buy

| Package | Where it shows | Price (default) |
|---|---|---|
| Banner ad | Top of the home page, community feed, blog posts or everywhere | Rs 500 / week (1, 2 or 4 weeks) |
| Sponsored post | Inside the community feed, after the 3rd post, with a "Sponsored" label | Rs 300 / day (1, 3, 7, 14, 30 days) |
| Featured business listing | `/businesses`, searchable by city and category, with its own page `/businesses/ID` | Rs 1,000 / month (1, 3, 6, 12 months) |
| Sponsored contest | A form: the advertiser tells you the prize and budget, you contact them | From Rs 5,000 |
| Pay-per-click | Banner slot and feed slot, only while the advertiser's wallet has money | Rs 3 / real click |

## Steps

1. **Run `migration_v39.sql`** in the Neon SQL Editor (before you deploy). It is safe to run twice.
2. Copy the files from this zip into your project (same folder names), then:
   ```
   git add -A && git commit -m "V39 advertise" && git push
   ```
3. (Optional) add these to Railway Variables to change prices and texts. Every one has a default:
   ```
   AD_BANNER_RS_WEEK=500
   AD_FEED_RS_DAY=300
   AD_LISTING_RS_MONTH=1000
   AD_CONTEST_RS=5000
   AD_CPC_RS=3
   AD_MIN_TOPUP_RS=500
   AD_PAY_INFO=Pay to JazzCash 0300-XXXXXXX (Your Name). Write your ad number in the payment note.
   AD_CONTACT=WhatsApp 0300-XXXXXXX
   ```
   `AD_PAY_INFO` is shown to advertisers after approval, so put your real JazzCash / Easypaisa number there.

## How the money flow works

* **Banner, sponsored post, listing:** the advertiser submits, you press **Approve** in `/admin/ads`, the advertiser gets a notification with the price, pays you by JazzCash / Easypaisa, and you press **Mark paid, start**. The ad starts at that moment and ends by itself.
* **Pay-per-click:** you approve once. The advertiser adds money from `/advertise/dashboard` (they send the money, then enter the transaction ID). You check your app and press **Approve** on the top-up. After that every real click is taken from their wallet. When the wallet is empty the ad stops showing and the advertiser gets a notification.
* **Contest:** it is only an enquiry. Approve it, then contact the advertiser on the phone / WhatsApp number they gave.

## What counts as a real click or view

* Bots are ignored (same bot list as your analytics).
* The advertiser's own views and clicks and all admin views and clicks are ignored.
* One visitor (IP + browser) is charged for only one click per ad per day.
* Clicks go through `/ads/ID/go` and then on to the advertiser's website, WhatsApp or phone. Only running ads can redirect, so pending ads cannot be abused as open redirects.

## Where to find things

* Visitors: `/advertise` (packages), `/businesses` (listings)
* Advertisers: `/advertise/dashboard` (also "My Ads" in the account menu)
* You: `/admin/ads` (account menu > Ads, with a red badge for waiting items)
* The "Local Businesses" link was added to the main menu, and both pages were added to `sitemap.xml`.

## Files

New: `migration_v39.sql`, `lib/ads.js`, `routes/ads.js`, `views/advertise.ejs`, `views/ad-new.ejs`, `views/ad-dashboard.ejs`, `views/ad-report.ejs`, `views/businesses.ejs`, `views/business.ejs`, `views/admin-ads.ejs`, `views/partials/ad-assets.ejs`, `views/partials/ad-unit.ejs`, `views/partials/ad-banner.ejs`, `views/partials/ad-state.ejs`, `views/partials/admin-ad-row.ejs`

Changed: `app.js`, `lib/images.js`, `routes/posts.js`, `views/partials/header.ejs`, `views/partials/feed-cards.ejs`

## Good to know

* If you forget the migration the site still works; only the ad slots stay empty and the console shows "migration_v39.sql chali?".
* Express 5 does not accept `(a|b)` in route paths, so actions like approve / reject are checked inside the route.
* Prices for a running ad are fixed when it is created, so changing the Railway variables does not change old ads.
