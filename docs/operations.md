# Operations

## Deploying

Production runs on Liip's Kubernetes cluster: see `kubernetes/README.md` for the chart, releases and access. What follows holds for any host.

The host builds the `Dockerfile` and runs `node build` on port 3000; migrations run at startup. The database is one SQLite file, `/data/parlaqui.db` in the image (`DATABASE_PATH`), next to its write-ahead log (`-wal`, `-shm`): `/data` must be a persistent volume on a local disk of the node, never a network file system, which breaks SQLite's locks. The app runs as `node` (uid and gid 1000) and must be able to write there: Docker's named volumes take the ownership of the image's `/data`, but a Kubernetes volume needs `securityContext.fsGroup: 1000` on the pod. A database that cannot be opened stops the process at startup, before `/healthz` can answer. Run one instance only; a deploy that stops the old container before it starts the new one (Kubernetes `strategy: Recreate`) is the simplest. An overlap of the two on the same volume is safe, since a writer waits up to 5 s for the other (`busy_timeout`). Required environment: `ORIGIN`, `PARL_API_KEY`, `IMPORT_TOKEN`; behind a reverse proxy also `ADDRESS_HEADER` and `XFF_DEPTH` (see `.env.example`). Optional: `ROKKA_API_KEY` (portrait refresh, see `docs/import.md`), `INSIGHTS_TOKEN` (audience, see `docs/analytics.md`).

The image runs as the `node` user. Its `HEALTHCHECK` calls `/healthz`, which applies the migrations if they have not run yet, then answers `200 ok` once the database answers `select 1`, or `503` otherwise; it is left out of rate limits, the visitor lookup and the audience counts. `/healthz/roster` is for monitoring: `200 ok, last published <time>`, or `503` once the last published roster is more than 36 hours old, so a missed nightly import alerts the next day, long before the home page warns visitors after three days. It stays out of the container's health check, so a failing import never takes the pod out of service. The version marker `/vcs_branch_sha` comes from the `VCS_BRANCH_SHA` build argument.

The flood protection (`docs/game.md`) logs at startup whether it reads the visitor's address from `ADDRESS_HEADER`; in production, a line saying it is not set means the proxy setting is missing and every visitor shares one address. While requests are refused, it logs one line a minute with the count per limit.

On `SIGTERM` (`docker stop`) or `SIGINT` (ctrl-c), adapter-node stops accepting requests and lets the running ones finish, then the database is closed and the process ends. `docker stop` kills the container 10 s after `SIGTERM` by default, so a running request gets up to 10 s; adapter-node's own limit (`SHUTDOWN_TIMEOUT`, 30 s by default) only applies when the platform's stop timeout is longer (`docker stop --time`, `stop_grace_period` in compose).

Round photos (`/photo/`), portraits (`/portrait/`) and score images (`/{lang}/s/…/story.jpg`) are rendered at most four at a time each, one render per image however many ask for it, and kept in memory. An image already rendered is served from memory without its source; otherwise the source portrait is downloaded before a photo or portrait joins that queue, so a slow rokka or parlament.ch never holds a render slot. Behind those four, at most 400 round photos (a class starting together asks for about thirty), 500 portraits (the members page asks for all 246 at once on a cold cache) and 50 cards wait; one more answers `503` with `Retry-After: 2` instead of queueing without bound.

Every response of the application carries `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` and, when `ORIGIN` is https, `Strict-Transport-Security`; `/insights` also gets `Cache-Control: private, no-store`. Files adapter-node serves on its own, before `hooks.server.ts` runs (`/_app/immutable/*`, `/images/*`, the icons, `manifest.webmanifest`, `llms.txt`, `/vcs_branch_sha`), carry none of these headers; set at least `X-Content-Type-Options` and `Strict-Transport-Security` at the reverse proxy too. Pages carry a Content Security Policy set in `svelte.config.js` (`kit.csp`, hash mode): only same-origin scripts, images, fonts and requests, no framing. A new external resource needs its origin added there.

The server imports the roster once a day by itself (`docs/import.md`), so the platform needs no scheduler. Every other host name pointing at the instance (`www.`, other domains) is redirected to `ORIGIN` by `hooks.server.ts`, so the platform only has to route those names to the container.

### Migrations stay additive

`migrations/001_schema.sql` is the whole schema; a later change is a new numbered file. The runner applies all pending files in one write transaction, so a second process waits and then finds nothing to do, and a failing file rolls them all back: `/healthz` keeps answering `503`, and the next request or health check tries again. When an old container may still be running, a migration must not break its code: add tables, columns with a constant default and indexes; drop or rename only in a later release. SQLite cannot change a constraint in place, only by copying the table into a new one, which holds the write lock for the copy. Foreign keys are off while the migrations run, so dropping the old table does not delete or empty the rows that reference it; they are checked before the commit, and a broken reference rolls everything back.

## Logs

The container logs to stdout only: startup lines, the warnings named in these docs and SvelteKit's line for each request that ends in an error. Have the host rotate the container logs (for Docker, the `json-file` driver with `max-size` and `max-file`, or the platform's own log retention), so they never fill the disk.

## Backups and restore

Configure on the platform a daily backup of the volume, kept for 14 days and stored away from the instance, so losing the server does not lose its backups. What matters is the games and the audience counters; the roster comes back with the next import anyway. A copy of the live file taken while the app writes can be torn, and most recent writes sit in `parlaqui.db-wal`, not in the file itself. So the app takes its own snapshot, `/data/backup.db`, at startup and then once per Zurich day; this is the file the platform's backup must keep. It is written aside, then renamed, so it is never caught half-written, and it takes about as much space on the volume as the database. A failed snapshot is logged and retried at the next hourly check. To take one by hand: `rm -f /data/manual.db && node -e "require('better-sqlite3')('/data/parlaqui.db').exec(\"vacuum into '/data/manual.db'\")"` (`vacuum into` refuses to overwrite a file, hence the `rm`).

Test a restore after any change to the backup setup:

1. Take the latest backup file, for example `backup.db`.
2. Start the app on a copy of it: `npm run build && cp backup.db /tmp/restore_test.db && DATABASE_PATH=/tmp/restore_test.db PORT=4320 node build`.
3. Run `scripts/readiness.sh http://localhost:4320`. Without `--production` or `--staging` it leaves out the crawler checks, which depend on the host name and the platform, and the other host names are only checked against `https://parlaqui.ch`. Pages, member counts and the game smoke test must pass; the freshness check fails if the backup is more than three days old, which says the backup is late, not that the restore failed.
4. Stop the app and delete `/tmp/restore_test.db` with its `-wal` and `-shm` files.

## Readiness

`scripts/readiness.sh <base-url> [--production | --staging] [--resolve <ip>]` checks an instance in one go: `/healthz`, every page in four languages, the member counts, data freshness, a whole game played with a cookie jar (round photos as JPEG, six options, the verdicts, the summary, a share and its story image as JPEG), robots and sitemap, previews, the noindex of the game page, that the protected routes stay hidden, and, when the base is `https://parlaqui.ch`, that the other host names (`www.`, `parlaqui.swiss`, plain http) redirect to it.

`scripts/measure-downtime.sh <base-url> [ip]` polls `/healthz` every half second during a release and prints each cut and the longest one; stop it with Ctrl-C once the new pod serves.

- `--production` expects crawlers to be let in (robots.txt allows them, no `x-robots-tag` on pages); `--staging` expects them kept out. Without either, the crawler checks are left out.
- `--resolve <ip>` sends every request for the Parlaqui host names (and the base's own name) to that address, so a new production instance can be tested on its own address before DNS points to it: `scripts/readiness.sh https://parlaqui.ch --production --resolve 203.0.113.10`.

The smoke test leaves one finished game behind; it answers each round at once, so the game may be unranked as `fast` and not count in anyone's percentile; it takes about fifteen seconds, the pauses of the reveals included. The script exits non-zero on any failure, so it can run from a scheduler.
