# Privacy

The privacy page (`/{lang}/privacy`, texts in `src/lib/privacy/`) describes what the code actually does. Keep it in step with these places:

| Page section                                                                                 | Code                                                                                 |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Game cookie `pq.visitor`, 30 days after the last game                                        | `src/lib/server/visitor.ts`                                                          |
| Language cookie `pq.lang`, one year                                                          | `src/routes/[lang=language]/+layout.server.ts`                                       |
| Games, answers, times, scores                                                                | `game` and `game_round` in `migrations/001_schema.sql`                               |
| Score image prepared at the end of every game, before any tap on Share                       | `src/lib/components/GameOver.svelte`, `src/lib/server/game/share.ts`                 |
| Audience counter, daily fingerprints kept, DNT and GPC, referrer host only                   | `src/lib/server/analytics.ts`, `docs/analytics.md`                                   |
| Games started per day still counted under DNT and GPC                                        | `countGameStarted` in `src/lib/server/analytics.ts`, called by `game/store.ts`       |
| Addresses in memory only                                                                     | `src/hooks.server.ts`, `src/lib/server/rate-limit.ts`                                |
| Visitor link deleted about 90 days after the last game started, games kept                   | `src/lib/server/retention.ts`, `visitor.last_game_at` in `migrations/001_schema.sql` |
| Audience kept 400 days, games started per day included                                       | `pruneAnalytics` in `src/lib/server/analytics.ts`                                    |
| Unfinished games deleted with their rounds about 24 hours after the start                    | `pruneAbandonedGames` in `src/lib/server/retention.ts`                               |
| Daily copy of the database, so deleted rows stay in it until the next copy, normally one day | `src/lib/server/db/backup.ts`, `kubernetes/README.md`                                |

The deletions run from timers in the `init` hook of `src/hooks.server.ts`, not from page views, once at startup after the migrations and then on a schedule. Unfinished games are deleted every ten minutes, so one is gone at most ten minutes after its 24 hours. The visitor links and the audience rows are checked every hour, and `createDailyTask` (`src/lib/server/daily.ts`) makes that run once per Zurich day and try again at the next hourly check after a failure, which is logged. The visitor prune reads `visitor.last_game_at`, set when a game starts, so a device whose recent games were unfinished and already deleted is not taken for inactive. The timers do not keep the process alive and are not started on an in-memory database (`DATABASE_PATH=:memory:`, the tests).
