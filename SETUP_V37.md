# V37: Automatic voice commentary (Street Cricket)

## Deploy
No migration, no npm package, no .env setting. Just copy the files and push.

## What it does
- On the public scorecard (/cricket/m/ID) and on the scorer page there is a **"Voice commentary"** switch.
- Once it is ON, every new ball that is scored is detected automatically and announced by voice. Nobody has to type anything.
- Every ball gets a different sentence (a random pick from several per event, never the same one twice in a row) and a different tone:
  - Sixes: loud, high-pitched and funny ("...the ball needs a passport!").
  - Wickets: low and dramatic, naming the batter who is out and the bowler.
  - Fours, wides, no balls, byes, leg byes, singles, dots: each has its own lines.
  - Extras: fifty and hundred for a batter, end of the over with the score, the runs needed in the last 12 balls of a chase, innings break with the target, and the final result.
- "Style": Funny or Normal. "Voice": any voice installed on the device (default = best English voice). "Test voice" plays a sample.
- Undo is silent. When someone opens the page in the middle of a match it stays silent until the next ball.
- The same line is also shown as text under the switch.

## Limits (browser text-to-speech)
- Uses the browser's built-in voices: free, no API key. The voices differ per device (Chrome on Android and Windows have good ones).
- The browser needs one tap on the switch before it allows sound, so it cannot start by itself.
- The commentary is spoken on the device of the person who switched it on. It is not mixed into the live stream and it cannot be saved as an audio file. For a downloadable mp3 or for sound inside the stream a server text-to-speech service is needed.
- Commentary text is English.

## Files
New: views/partials/cricket-commentary.ejs
Changed: views/partials/cricket-board.ejs, views/cricket-match.ejs, views/cricket-score.ejs
