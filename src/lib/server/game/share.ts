import { randomBytes } from 'node:crypto';
import type { CouncilChoice } from '$lib/game/protocol';
import { sql, type Db } from '../db/sqlite';
import { GameRefusal } from './store';

const SHARE_TOKEN = /^[A-Za-z0-9_-]{22}$/;

type SharedGame = { score: number; total: number; correct: number; council: CouncilChoice };

// the token is the only key to a shared score: random, and it names neither the game nor the visitor
export async function shareGame(
	db: Db,
	{ gameId, visitorId }: { gameId: string; visitorId: string }
): Promise<string> {
	const game = db.get<{ visitor_id: string | null; finished_at: number | null }>(
		sql`select visitor_id, finished_at from game where id = ${gameId}`
	);
	if (!game || game.visitor_id !== visitorId) throw new GameRefusal(404, 'game.notFound');
	if (game.finished_at === null) throw new GameRefusal(409, 'game.stale');

	const row = db.get<{ share_token: string }>(sql`
		update game set share_token = coalesce(share_token, ${randomBytes(16).toString('base64url')})
		where id = ${gameId}
		returning share_token
	`)!;
	return row.share_token;
}

export async function sharedGame(db: Db, token: string): Promise<SharedGame | null> {
	if (!SHARE_TOKEN.test(token)) return null;
	const row = db.get<SharedGame>(sql`
		select score, total, correct, council from game
		where share_token = ${token} and finished_at is not null
	`);
	return row
		? { score: row.score, total: row.total, correct: row.correct, council: row.council }
		: null;
}
