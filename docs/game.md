# Game

## Flood protection

There is no limit on the number of games a person can play. Limits in `src/hooks.server.ts` only stop automated floods. Each counts in a sliding window, per visitor (the visitor cookie) and per address:

| Requests                                       | Per visitor       | Per address          |
| ---------------------------------------------- | ----------------- | -------------------- |
| `POST /api/game` (starting a game)             | 60 per 10 minutes | 1 800 per 10 minutes |
| Every request under `/api/game/` and `/photo/` | 300 per minute    | 9 000 per minute     |
| `/portrait/` (the members page)                | none              | 10 000 per minute    |
| `/{lang}/s/` (score images)                    | none              | 1 200 per minute     |
| `POST /insights/login`                         | none              | 10 per 10 minutes    |

The per-visitor limits sit far above what a human can do. A round takes at least about 1.3 s and costs three requests (the photo, the answer, the next round), so a fast player stays well under 300 requests a minute and starts a few games in ten minutes at most. The per-address ceilings of the game are thirty times higher and apply to every request, with or without a cookie. A request without a cookie (the very first start) only meets the address ceiling.

What fits behind one address therefore depends on the pace. At the fastest possible pace (about 140 requests a minute per player), 9 000 requests a minute hold about 65 players at once; at one round every five seconds (36 requests a minute), about 250. The starts hold 180 players who each start a game every minute. A cold members page costs 246 portraits, so 10 000 a minute is about 40 first visits a minute; the browser then keeps the portraits for a day. A larger group behind one address (a whole school on one connection, or a proxy without `ADDRESS_HEADER`) can reach these ceilings, and is then refused until its window frees up, at most a minute for game requests and ten minutes for starts.

The visitor key is a hash of the raw cookie value, computed in memory, so the limiter needs no database lookup and runs before it. A made-up cookie therefore gets a fresh visitor budget, but never more than its address's ceiling. IPv6 addresses are counted by their /64 prefix, since one subscriber usually holds a whole /64; an IPv4-mapped IPv6 address counts as its IPv4 address.

Over a limit the server answers `429` with a `retry-after` header in seconds and `{ "message": "game.tooFast" }`; the browser translates the key. Refusals are counted per limit and logged as one line a minute when there were any (`flood protection refused 12 requests in the last minute: addressTraffic 12`), never per request and never with an address.

Keys live only in process memory, at most 10 000 per limit, and are never stored. A restart forgets them.

Behind a proxy, `getClientAddress()` only returns the visitor if `ADDRESS_HEADER` and `XFF_DEPTH` are set (see `.env.example`); without them every visitor shares the proxy's address ceiling. Without a proxy, leave them unset: adapter-node cannot read a header the request does not carry. If the address cannot be read, the limiter logs it once and counts those requests under one shared address instead of failing them. At startup the server logs whether it reads the address from `ADDRESS_HEADER` or from the connection, so a missing proxy setting shows in the first lines of the log.

## Options

A game deals ten different people (`src/lib/server/game/deal.ts`). Each round shows the answer and five other members of the same gender. Those five are never the answer of an earlier round: such a name could only be wrong. They may be anyone else, including the answer of a later round, so a name already seen as a wrong option is as likely to be a later answer as any other, and ruling out the names seen before gives no hint. Only when a gender has too few members left does a round fall back to earlier answers. A replacement round (see below) follows the same rule: its answer is no one dealt in the game, and its options leave out the answers of the rounds before it.

## Timing

The server runs the clock; the browser only shows it. Every timestamp comes from the request handler (`new Date()`), never from the database, and every round keeps its own in `game_round`: `ready_at`, `photo_served_at`, `clock_started_at`, `answered_at`. They stay after the game, for moderation of implausible games. A game nobody finishes is deleted with its rounds 24 hours after its start (`pruneAbandonedGames` in `src/lib/server/retention.ts`); a browser still holding it then gets `404 game.notFound`.

A round comes in two steps:

1. The browser gets the photo URL (`/photo/<token>`, a random token per round) and loads it. Nothing in the URL tells who is on the photo.
2. Once the photo is shown, it calls `start` and gets the six options, the round's `deadline` (the clock start plus 10 s) and `serverNow`, both in epoch milliseconds on the server's clock. The clock starts at that call.

The browser shows `deadline - serverNow` minus half the round trip it measured for that request, never more than 10 s and never more than the server's own figure, so a slow response shows less time rather than time the server would no longer accept. The two clocks are never compared. The response also carries `remainingMs` (the same figure) for browsers still running the previous version during a deploy.

Rules, in `src/lib/server/game/timing.ts`:

- **Grace**: the clock starts no later than 3 s (`PHOTO_GRACE_MS`) after the photo was served (after the round became ready if the photo was never served). A photo served before the round became ready was preloaded during the reveal and is already in the browser, so its grace is only 1 s (`PRELOAD_GRACE_MS`) from the ready time. Holding back `start` to look at the photo first buys at most 3 s when the photo loads with the round, 1 s when it was preloaded.
- **No start, no points**: an answer to a round whose clock never started (no `start` call) scores 0 and counts as wrong, even if it is right: otherwise a client could look at the face as long as it likes and answer without ever starting the clock. A `null` answer (the time ran out) ends such a round as usual.
- **Allowance**: the first 300 ms (`ANSWER_ALLOWANCE_MS`) after the clock starts are free, for the time the options take to arrive and be drawn. Points are the tenths of the 10 s left after that, rounded down: an answer 1.3 s after `start` gives 9.
- **Late slack**: an answer that reaches the server more than 10 s + 300 ms + 1 s (`LATE_SLACK_MS`) after the clock started scores 0 and counts as wrong, even if it is right. The slack covers the network; the client already stops at 10 s.
- **Reveal**: after an answer the browser shows the verdict for 1 s if right, 3 s if wrong. The next round is ready only at the end of the reveal: `start` or `answer` before that is refused with `409 game.stale`, so the options cannot be fetched during the reveal. The browser may preload the next photo meanwhile. Its own reveal timer only runs once the verdict has arrived, so an honest client always calls `start` after the server's ready time.
- **Reveal window**: the reveal itself (1 s after a right answer, 3 s after a wrong one) is time in which the next photo may already be loaded, and a modified client can look at the next face before the round is ready. The server cannot see what happens in the browser during that time; the per-round timestamps kept in `game_round` make such games visible to moderation later.

An answer sent twice (a retry after a lost response) gets the same verdict back and is counted once. Answers are serialized: each one is a single write transaction. The browser retries `start` (and the photo replacement it carries) and `answer` once when a request gets no response or a `2xx` whose body is cut off or not the expected shape, straight away, or a `502`, `503` or `504`, after 300 to 800 ms. It never retries the start of a game: a lost response there would leave a game nobody plays.

### Replacing a round

When a photo cannot be loaded, the browser loads it again after 0.5 s, then after 1.5 s more, and says so in place of the question (`game.photoRetry`). If it still fails, the browser may ask once per game, before `start`, for that round to be replaced by another person (`photoFailed: true` with the `photoUrl` that failed), and says so until the new photo is shown (`game.photoReplace`). When that photo was last refused only because the server was busy (`503`, see "Photos"), the server answers with the same round instead, once per refusal, and spends nothing (the request carries a random `attempt` id that a retry after a lost response repeats, so the retry gets the same round too): the browser loads the same photo again after 2 s and starts its two retries afresh. A photo that fails for any other reason, or that fails again without the server refusing it, is replaced as usual. The replaced round stays in the database, marked void. A game with a replaced round is unranked (`unranked = 'photo'`): otherwise "the photo failed" would be a skip button for a face one does not know.

The same request sent again (a retry after a lost response, naming the photo that was already replaced) gets the same replacement back and is counted once. Any other replacement request, including one for the replacement's own photo, is refused with `409 game.photoTrouble`, and the browser then ends the game with that message. Every error that ends a game offers a new game on the same council, started only when the player asks for it.

## During a deploy

For the few seconds a deploy takes, the old container still answers some requests. The browser accepts both versions: a round start without `deadline` and `serverNow` shows `remainingMs` (minus half the round trip), and a game start without `council` keeps the one the browser sent. Games handled by the old container meanwhile are not counted in `games_started_day` and are not marked `unstarted`. A page loaded before the deploy keeps its old code until it is reloaded; if it still asks for a game without a time limit (`timed: false` with `POST /api/game`), the server ignores the field and starts a timed one; when it sends no `attempt` id with a photo refused for load and the answer is lost, its retry is treated as a new failure and spends the replacement.

## Switching language

The language links keep the address's query, so `?council=` survives a switch on every page. A switch during a game keeps the game running: the page shows the new language, the server keeps naming the options in the game's language, and the end screen and "play again" use the council the server returns with the started game, never the one in the address.

## Photos

Each round has its own random photo URL, so a photo cannot be matched to a person by its address. The server loads the portrait from rokka first (3 s timeout), then from parlament.ch (10 s), and renders one variant per round (small random crop, re-encoded, no metadata) from the crop stored with the round. Variants and sources are cached in memory (at most 300 variants and 400 sources) and regenerated after a restart; a variant already rendered is served without its source, so it keeps working when the source is gone; rounds that ask for the same portrait at once share one download. A source is cached only once it decodes as an image, and dropped again if a variant cannot be rendered from it, so a broken download is fetched afresh next time. Rokka fetches a remote image once and never checks it again, so its copies of portraits that parlament.ch later replaced go stale. With `ROKKA_API_KEY` set, every published roster import therefore downloads each active member's portrait from parlament.ch, compares its SHA-1 with the one stored in `member.photo_sha1`, and uploads a changed portrait to rokka, storing the new `photo_hash`. A portrait that cannot be downloaded, does not fully decode, is smaller than 100 px, is larger than 5 MB, is the very same file as another member's (a placeholder), or cannot be uploaded even after one retry keeps the copy already stored, so a bad day on parlament.ch never replaces a good photo. A member whose portrait parlament.ch stops serving keeps their photo code, and so their place in the game, as long as rokka holds a copy. The game asks rokka for `photo_hash` when the member has one, then falls back to parlament.ch; members without one still use rokka's remote copy. The source is downloaded before the variant joins the render queue, so a slow download never holds a render slot. Variants are rendered four at a time, once per round however often the photo is asked for; when 400 more already wait, the photo answers `503` with `Retry-After: 2` (see `docs/operations.md`). The browser cannot see that status on an image, so it counts the refusal as a failed load and retries as usual (see "Replacing a round"); the server remembers the last 2 000 tokens refused this way, in memory only, so a replacement asked for such a photo hands back the same round instead. A photo that cannot be served answers `502` and logs one line with the photo code and the cause, never the round's token. `photo_served_at` is recorded only once the image was actually produced, so a failing source leaves the round's clock grace untouched.

## Screen readers and keyboard

The six answer buttons are keyed by position and stay in the page from round to round: while a photo loads they are empty, `aria-disabled` and named only by `game.preparing` ("Préparation de la partie…"), so they reveal nothing and accept no answer, and the focus of a screen reader or a keyboard stays on its button. When a round opens, focus that is on an answer button stays there; a keyboard player whose focus is elsewhere gets the first answer. A visually hidden `role="status"` (`Game.svelte`) says "Manche 3 sur 10" as a round opens and the time left once at 5 and once at 2 seconds (`src/lib/game/callouts.ts`), never each second. The portrait's alt text never names the person. The end screen moves the focus to its heading.

## Score summary

There are no accounts. After a game, `GET /api/game/:id/summary` tells the visitor who played it how the score compares and what this device has done. It answers `404` for another visitor's game and `409` while the game is still running.

- `betterThan`: the share of the other finished games of the same month with the same council filter that scored strictly lower, rounded down. The month is the one the game finished in, in Europe/Zurich time, so a game finished just before midnight on the last day keeps its month. Unranked games (see below) are neither compared nor given a percentile. The month's ranked scores of each council are counted into 101 score buckets and kept in memory for 60 s (`HISTOGRAM_TTL_MS`), so an end screen costs no scan of the month; a game that finished after the counts were taken is not in them yet, and one that is in them is not compared with itself. It is `null` below ten comparison games and when it would be 0, so a weak game never reads as a boast.
- `best`, `games` and `average`: the highest score, the number and the rounded mean of this visitor's finished games of the same council, up to and including this one. A record on the Council of States says nothing about the National Council, so nothing is mixed.
- `previousAverage`: the same mean before this game, which the end screen compares the score with; `null` on a first game of that council.
- `newBest`: the score beats every earlier finished game of this visitor in that council; never true for a first one.

Reasons for `game.unranked`, set at most once:

- `photo`: a round was replaced after its photo failed (see above).
- `unstarted`: set when the game finishes, if a live round was answered without `start` (see "No start, no points"). Only a script does that, and its games would only drag everyone else up.
- `fast`: set when the game finishes, if at least eight live rounds are right (`IMPLAUSIBLE_MIN_CORRECT`) and the median answer time (`answered_at - clock_started_at`) is under 600 ms (`IMPLAUSIBLE_MEDIAN_MS`). No one reads six names that fast ten times; such a game would only push everyone else down. Counting near-perfect games too means one or two deliberate misses no longer keep a script ranked.

"This device" is the visitor cookie. It lasts 30 days and is renewed with each new game, so the record survives as long as the player keeps playing.
