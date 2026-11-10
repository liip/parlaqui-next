import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql, type Db } from './db/sqlite';
import { testDb } from '../../../test/db';
import { pruneAbandonedGames, pruneVisitors } from './retention';

const NOW = new Date('2026-12-31T12:00:00Z');

describe('pruneVisitors', () => {
	let db: Db;

	function visitor(createdAt: string): string {
		const id = randomUUID();
		db.run(
			sql`insert into visitor (id, token_hash, created_at) values (${id}, ${randomBytes(32)}, ${new Date(createdAt)})`
		);
		return id;
	}

	function game(
		visitorId: string,
		startedAt: string,
		finishedAt: string | null = startedAt
	): string {
		const id = randomUUID();
		db.run(sql`
			insert into game (id, visitor_id, council, language, total, score, started_at, finished_at)
			values (${id}, ${visitorId}, 'all', 'fr', 10, 42, ${new Date(startedAt)}, ${finishedAt && new Date(finishedAt)})
		`);
		return id;
	}

	beforeEach(() => {
		db = testDb();
	});

	it('forgets a visitor whose last game is over 90 days old and keeps the game anonymous', async () => {
		const gone = visitor('2026-06-01T10:00:00Z');
		const oldGame = game(gone, '2026-09-01T10:00:00Z');

		expect(await pruneVisitors(db, NOW)).toBe(1);

		expect(db.all(sql`select id from visitor`)).toHaveLength(0);
		const row = db.get(sql`select visitor_id, score from game where id = ${oldGame}`);
		expect(row).toEqual({ visitor_id: null, score: 42 });
	});

	it('keeps a device whose recent games were unfinished and already pruned', async () => {
		const player = visitor('2026-06-01T10:00:00Z');
		game(player, '2026-09-01T10:00:00Z');
		db.run(
			sql`update visitor set last_game_at = ${new Date('2026-12-29T10:00:00Z')} where id = ${player}`
		);
		game(player, '2026-12-29T10:00:00Z', null);

		expect(await pruneAbandonedGames(db, NOW)).toBe(1);
		expect(await pruneVisitors(db, NOW)).toBe(0);
		expect(db.all(sql`select id from visitor`)).toHaveLength(1);
	});

	it('keeps a visitor who played within 90 days, and a new one who has not played yet', async () => {
		const regular = visitor('2026-01-01T10:00:00Z');
		game(regular, '2026-03-01T10:00:00Z');
		game(regular, '2026-12-20T10:00:00Z');
		const newcomer = visitor('2026-12-30T10:00:00Z');

		expect(await pruneVisitors(db, NOW)).toBe(0);
		expect(
			db
				.all<{ id: string }>(sql`select id from visitor`)
				.map((row) => row.id)
				.sort()
		).toEqual([regular, newcomer].sort());
	});

	it('forgets an old visitor who never finished a game', async () => {
		visitor('2026-08-01T10:00:00Z');
		expect(await pruneVisitors(db, NOW)).toBe(1);
	});
});

describe('pruneAbandonedGames', () => {
	let db: Db;

	beforeAll(() => {
		db = testDb();
		db.run(sql`
			insert into member (id, first_name, last_name, gender, council, canton, party, updated_at)
			values (1, 'Ada', 'Muster', 'f', 'N', 'BE', '{}', ${NOW})
		`);
	});

	function game(startedAt: string, finishedAt: string | null): string {
		const id = randomUUID();
		db.run(sql`
			insert into game (id, visitor_id, council, language, total, started_at, finished_at)
			values (${id}, null, 'all', 'fr', 10, ${new Date(startedAt)}, ${finishedAt && new Date(finishedAt)})
		`);
		db.run(sql`
			insert into game_round (game_id, round_index, member_id, option_ids, photo_token, photo_code, crop)
			values (${id}, 0, 1, '[1]', ${randomUUID()}, 'x', '{}')
		`);
		return id;
	}

	it('deletes games left unfinished for over 24 hours, with their rounds, and keeps the rest', async () => {
		const abandoned = game('2026-12-30T11:59:00Z', null);
		const running = game('2026-12-30T12:01:00Z', null);
		const finished = game('2026-12-01T10:00:00Z', '2026-12-01T10:05:00Z');

		expect(await pruneAbandonedGames(db, NOW)).toBe(1);

		const games = db.all<{ id: string }>(sql`select id from game`);
		expect(games.map((row) => row.id).sort()).toEqual([running, finished].sort());
		expect(db.all(sql`select 1 from game_round where game_id = ${abandoned}`)).toHaveLength(0);
		expect(db.all(sql`select game_id from game_round`)).toHaveLength(2);
	});
});
