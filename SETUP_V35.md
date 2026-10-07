# V35: Street Cricket Manager + live stream score bar + category headlines bar

## BEFORE you deploy
1. Run `migration_v35.sql` once in the Neon SQL Editor (safe to run again).
2. Deploy the code. No new npm package or .env setting is needed.

## Street Cricket Manager (/cricket)
- The navbar has "Street Cricket" and the menu has "Street Cricket Manager".
- A logged-in user creates a tournament (name, city, overs), adds teams and players (names separated by commas or new lines), makes fixtures (one by one, or "Auto-create all fixtures" = every team plays every other team once) and presses "Start scoring" on a fixture.
- Scorer page (/cricket/m/ID/score, built for phones): toss -> choose striker / non-striker / bowler -> tap a run button (0-6). Toggles for Wide, No ball, Bye, Leg bye and Wicket (bowled, caught, lbw, run out, stumped, hit wicket). "Undo last ball" is always there. Strike changes by itself (odd runs, end of over); after a wicket a new batter is asked for, after an over a new bowler. When an innings ends press "Start 2nd innings"; in the chase the target, runs needed, RRR and the result (won by N wickets / runs / tied) are worked out for you.
- Public live scorecard: /cricket/m/ID (no login needed, refreshes every 4 seconds). "Share on WhatsApp" sends the link.
- Points table (win = 2, tie = 1) on the tournament page. Player career: /cricket/p/ID (runs, balls, SR, average, highest, 4s/6s, 50s/100s, wickets, overs, economy, best figures). A career adds up the balls of all tournaments of one organizer (a player is matched by name).
- To let a friend score, type their username under "Let a friend score" on the scorer page.

## Score bar on the live stream (switch)
- Switch on the scorer page: "Show score bar on the live stream" (`cricket_matches.show_on_stream`, default OFF).
- When it is ON and the organizer is live, a TV-style score bar appears on the host's screen and on every viewer's live screen.
- If the switch is OFF, the match is not live, or no stream is running, no bar is shown. For 10 minutes after the match ends the result stays in the bar.

## Headlines bar (every page, by category)
- Scrolling headlines under the navbar with a category dropdown. The choice is remembered in a cookie (`kz_cat`). The bar is hidden on the scorer page.

## Notes
- If migration_v35 has not been run, the /cricket pages show a 503 "needs migration" page and the rest of the site keeps working.
- The score bar needs the live migration (migration_v27) to have been run.
- The server caches the score for 2 seconds, so even 200 viewers do not load the database.
