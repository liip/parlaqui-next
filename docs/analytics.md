# Audience

Parlaqui counts its own audience, without cookies, without a third-party service and without storing addresses.

## What is counted

`hooks.server.ts` counts, after the answer is sent, every successful `GET` of a home page (`/{lang}`) or a members page (`/{lang}/members`), whether the page was loaded or reached by a link inside the app (`__data.json`). Each view adds one to a daily counter in `page_view`, split by page, language, device (`mobile` or `desktop` from the user agent) and the host of an outside referrer on a page load (`google.com`, never the path or the query). Only a plausible public host name is kept: lower-case, without `www.`, a port or an IP address, at most 253 characters, labels of letters, digits and hyphens, at least one dot. Any other referrer (an address, a port, a malformed value) is counted as `other`, so the totals stay right and nothing identifying is stored; no referrer, or one from Parlaqui itself, is stored as empty and not listed.

SvelteKit fetches a page's `__data.json` before the navigation itself, so `src/app.html` sets `data-sveltekit-preload-data="tap"`: the request starts when someone taps or clicks a link, not when a pointer merely passes over it, and a counted `__data.json` is a visit, not a hover.

Games are counted apart from the pages. `createGame` adds one to `games_started_day` (one row per Zurich day, a number and nothing else) in the transaction that creates the game, so a game left unfinished and deleted 24 hours after its start (see `docs/privacy.md`) stays counted as started. Migration `015_games_started_day.sql` filled the days before it from the games then stored. In production that included the games left unfinished, since the migration ran before the first prune of abandoned games ever did, so the days before it count the abandoned games too, like the days after. Finished games per day come from `game.finished_at`, since finished games are kept.

Each address (an IPv6 address by its /64, as for flood protection) is counted for at most 1 000 views per Zurich day; further views from it are ignored without a word, so a script can neither inflate the figures nor fill the tables by much. The cap is that high because a mobile carrier's NAT or a school network puts many people behind one IPv4 address. The count lives in memory only, for at most 50 000 addresses (the one seen longest ago goes first), and starts again at each new day or restart. A large school or a busy carrier address can still reach the cap, and its views beyond it go uncounted.

Not counted: robots and link previews (a user-agent pattern in `src/lib/server/analytics.ts`), requests without a user agent, and people whose browser sends `DNT: 1` or `Sec-GPC: 1`.

## Visitors without a cookie

A visitor per day is a SHA-256 of a random salt, the visitor's address and user agent, stored in `visitor_day`. The salt is drawn at the first view of each Zurich day and lives only in the server's memory, so a stored hash cannot be linked back to an address, and the same person gets an unrelated hash the next day. The count can be off both ways. A restart draws a new salt, so a visitor who comes back after a restart on the same day counts twice. And people who share an address and an identical browser (a class behind one school address on identical devices) collapse into one visitor, so a group like that is undercounted. `page_view`, `visitor_day` and `games_started_day` keep 400 days; the daily prune (see `docs/privacy.md`) deletes older rows.

## Reading it

In a browser: open `/insights/login`, type the token once, and `/insights` shows the totals, the days, the referrers (`other` reads "autre", the page being in French) and the split by language and device, with links for 7, 30, 90 and 365 days. The token is turned into a session cookie (`pq.insights`, path `/insights` only, httpOnly) holding its issue time and an HMAC of it keyed by the token: the server refuses it after 8 hours and as soon as the token changes, and it never contains the token. Without a valid session `/insights` answers 404, like `/api/insights` without the token, so neither tells anyone it exists; neither is linked or named in `robots.txt`. An address gets ten login attempts per ten minutes.

From a terminal:

```
curl -s -H "Authorization: Bearer $INSIGHTS_TOKEN" https://parlaqui.ch/api/insights | jq
curl -s -H "Authorization: Bearer $INSIGHTS_TOKEN" "https://parlaqui.ch/api/insights?days=90" | jq
```

The answer gives, per day of the span (30 days by default, at most 400), visitors, views per page and games started and finished, then the top 20 outside referrers, and views per language and per device over the span. Without `INSIGHTS_TOKEN` set (32 characters or more), the route answers 404.
