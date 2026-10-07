# V36: Street Cricket - English everywhere, live video inside the cricket pages, stylish score bar with player photos

## BEFORE you deploy
1. Run `migration_v36.sql` once in the Neon SQL Editor (safe to run again; `migration_v35.sql` must already be run).
2. Deploy the code. No new npm package or .env setting is needed. (Until migration_v36 is run everything keeps working, there are just no player photos.)

## What changed
- **English**: the feature is now called "Street Cricket" everywhere (navbar, menu, page titles, hero text) and code comments / docs are in English. URLs stay the same (/cricket ...). To use another name, search the project for "Street Cricket".
- **Live video inside the cricket pages** (no need to go to the Feed page):
  - Scorer page (/cricket/m/ID/score): a camera panel at the top with a **"Start camera"** button. It stays right there while you keep scoring (rear camera by default, switch with the flip button, mute / camera-off / end buttons). Going live turns the score bar ON automatically. When the live ends the recording is saved to the live post (as before) and you return to the scorer page.
  - Public scorecard (/cricket/m/ID): when the match has the stream switch ON and someone is live, a **"Watch live video"** panel appears above the scoreboard. Tap it and the video plays inline with the score bar on top (full-screen button included). Guests who are not logged in see a "Log in to watch" button; the scoreboard itself stays public.
  - If a friend is the assigned scorer and goes live from their own phone, the score bar and the video work for their stream too.
- **Stylish score bar** (live screen, host preview and inline panels): broadcast style with a LIVE tag, colour-coded team badge, big score, CRR, striker / non-striker / bowler cards, "this over" balls and chase info. TV-style banners for FOUR!, SIX! and WICKET!. It slides in when it first appears and does not flicker between updates.
- **Cricketer photos**: striker (gold ring), non-striker and bowler show their photo in the score bar (initials when there is no photo). Photos also appear in the scorecard tables, the tournament page and the player's career page. Add them with the camera button next to a player on the tournament page (or "Add photo" on the player's page). The picture is cropped to a square in the browser.

## New files
migration_v36.sql, views/partials/cricket-avatar.ejs

## Changed files
lib/cricket.js, routes/cricket.js, app.js, views/partials/live-ui.ejs, views/partials/cricket-assets.ejs, views/partials/cricket-board.ejs, views/cricket.ejs, cricket-score.ejs, cricket-match.ejs, cricket-tournament.ejs, cricket-player.ejs, views/partials/header.ejs, news-bar.ejs, lib/headlines.js, routes/headlines.js, routes/petitions.js, migration_v35.sql, SETUP_V35.md

## Notes
- Viewers need a Khabzo login to watch the video (the live system is login-only). In the default peer-to-peer mode a live supports a few viewers (`LIVE_MAX_VIEWERS`, default 6); for bigger audiences set up LiveKit as described in SETUP_V28.md.
- Going live needs HTTPS and camera / microphone permission.
- Keep the scorer page open while you are live: leaving it ends the live.
- One-phone setup: put the phone on a tripod, start the camera, and tap the run buttons below the video. Two phones: one streams (same scorer page), the other scores ("Let a friend score").
