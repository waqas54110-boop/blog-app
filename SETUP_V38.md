# V38: Creator Showcase + Trend Radar

## Deploy (3 steps)
1. Run `migration_v38.sql` once in the Neon SQL Editor (safe to run again). Do this BEFORE deploying.
2. Push the files to GitHub (no new npm package is needed).
3. Add the environment variables below on Railway, then redeploy.

## Environment variables
| Name | Needed? | What it does |
|---|---|---|
| `YOUTUBE_API_KEY` | Recommended | Live YouTube data for Trend Radar. Without it only Google Trends data shows. |
| `ANTHROPIC_API_KEY` | Optional | Switches on the "AI write-up" button (English / Roman Urdu / Urdu). |
| `TRENDS_AI_MODEL` | Optional | Default `claude-sonnet-5-5`. |
| `TRENDS_AI_DAILY_CAP` | Optional | Max AI write-ups per day for the whole site (default 30). Keeps the cost under control. |
| `TRENDS_SEARCH_DAILY_CAP` | Optional | Max YouTube keyword searches per day (default 40; each costs 100 quota units of the free 10,000). |

### How to get the YouTube API key (free)
1. Go to console.cloud.google.com and open your existing Google Cloud project (the one used for Google login).
2. APIs & Services > Library > search "YouTube Data API v3" > Enable.
3. APIs & Services > Credentials > Create credentials > API key. Under "API restrictions" choose "YouTube Data API v3" only.
4. Put the key in `YOUTUBE_API_KEY`.

## Creator Showcase (/creators)
- Logged-in users paste a YouTube or TikTok link (channel/profile or single video), add a title, niche and description.
- Only youtube.com / youtu.be / tiktok.com links are accepted (allow-list). Descriptions go through the spam filter, so links, ads and "sub for sub" requests are blocked.
- Community can: like, comment, leave "Honest feedback" (30+ characters), and vote "Creator of the Week".
- Voting: 1 vote per user per week (week starts Monday, site timezone), not for your own link, account must be 24 hours old.
- The "Visit channel / Subscribe" button just opens YouTube / TikTok in a new tab (YouTube asks the viewer to confirm). There are NO points or rewards for subscribing, which keeps the feature inside YouTube's rules. Clicks are counted for the creator.
- Limits: 3 new links per day, 10 links per user. Owner and admin can delete links and comments.

## Trend Radar (/trends)
- Login required to see a report (protects your API quota). Pick niche + platform (+ optional keyword).
- Data: YouTube "most popular in Pakistan" (by category, or keyword search for Food/Business/keywords) and the public Google Trends Pakistan feed.
- Report: trending searches, fast-growing videos, 10 video ideas, hashtags, common title words, best time to post (from when today's top videos were published), typical video length, Do/Don't tips.
- TikTok has no public trending API, so TikTok reports use Google + YouTube trends and generated hashtag ideas. The page says this openly.
- Reports are cached for 3 hours (so 1 YouTube request serves many users). AI write-ups are cached for 6 hours.
- The Google Trends feed is a public but unofficial feed. If Google changes it, that box shows "not available" and the rest still works.

## Files
New: `migration_v38.sql`, `lib/creators.js`, `lib/trends.js`, `routes/creators.js`, `routes/trends.js`, `views/creators.ejs`, `views/creator.ejs`, `views/creator-new.ejs`, `views/trends.ejs`, `views/partials/creator-card.ejs`, `views/partials/creator-assets.ejs`
Changed: `app.js` (routes + rate limits), `views/partials/header.ejs` (nav links), `routes/posts.js` (sitemap)
