import { sql, type Db } from './db/sqlite';

const VISITOR_RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

// the cookie lasts 30 days after the last game, so after 90 the link to a person serves nothing;
// last_game_at outlives the unfinished games the abandoned-game prune deletes
export async function pruneVisitors(db: Db, now: Date): Promise<number> {
	const before = new Date(now.getTime() - VISITOR_RETENTION_DAYS * DAY_MS);
	return db.run(sql`
		delete from visitor
		where coalesce(last_game_at, created_at) < ${before}
			and not exists (
				select 1 from game g where g.visitor_id = visitor.id and g.started_at >= ${before}
			)
	`);
}

const ABANDONED_GAME_HOURS = 24;

// a game nobody finished within a day is gone for good; its rounds go with it
export async function pruneAbandonedGames(db: Db, now: Date): Promise<number> {
	const before = new Date(now.getTime() - ABANDONED_GAME_HOURS * HOUR_MS);
	return db.run(sql`delete from game where finished_at is null and started_at < ${before}`);
}
