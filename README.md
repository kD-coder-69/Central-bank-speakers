# Central Bank Speakers – live dashboard

## Run it
1. Install Node.js 18 or newer (https://nodejs.org) if you don't have it.
2. Double-click `start.bat` (or run `node server.js` in this folder).
3. The browser opens http://localhost:3000. Colleagues on the same network can use the "On your network" address printed in the window.

Keep the window open. No npm install is needed.

## How it stays live
- The server downloads both PDFs every 60 seconds, and every 15 seconds between 14:55 and 15:30 UK time.
- The provider's CDN caches the files for up to an hour, so the server adds a cache-buster to every request. That way the 15:00 update shows up within seconds rather than up to an hour late.
- The page checks the server every 20 seconds (every 7 seconds around 15:00). When a file changes, it re-reads it and redraws with no reload.
- **Tomorrow tab:** until the tomorrow feed shows a later date than today, it shows a countdown to 15:00 UK time. It switches over automatically once the new lineup appears.
- **Today tab:** shows which speaker is next, which are in progress (up to 45 minutes after the start), and which are done.
- 15:00 is UK local time (Europe/London), so it follows BST/GMT changes.

## Change the port
`set PORT=8080 && node server.js`

## Teams updates (Vercel)
`/api/digest` posts an Adaptive Card to a Teams chat or channel through a Workflows webhook.

| Call | Posts |
|---|---|
| `/api/digest?type=morning&key=KEY` | Today's schedule |
| `/api/digest?type=evening&key=KEY` | Tomorrow's schedule + bias + last 2 comments |
| add `&preview=1` | Returns the card JSON without posting |

Vercel environment variables: `TEAMS_WEBHOOK_URL`, `DIGEST_KEY`, optional `DASHBOARD_URL`.
Schedule the two calls with cron-job.org (time zone Europe/London): 08:00 and 18:30.
