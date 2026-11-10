import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testDb } from '../../../../test/db';
import { sql, type Db } from '../db/sqlite';
import { shareGame, sharedGame } from './share';

describe('sharing a score', () => {
	let db: Db;

	async function visitor(): Promise<string> {
		const id = randomUUID();
		db.run(sql`
			insert into visitor (id, token_hash, created_at) values (${id}, ${randomBytes(32)}, ${new Date()})
		`);
		return id;
	}

	async function game(visitorId: string, finished = true): Promise<string> {
		const id = randomUUID();
		const now = new Date();
		db.run(sql`
			insert into game (id, visitor_id, council, language, total, round_index, score, correct,
				started_at, finished_at)
			values (${id}, ${visitorId}, 'N', 'fr', 10, 10, 73, 8, ${now}, ${finished ? now : null})
		`);
		return id;
	}

	beforeEach(() => {
		db = testDb();
	});

	afterEach(() => db.close());

	it('gives one random token per game, the same on every ask', async () => {
		const me = await visitor();
		const gameId = await game(me);

		const token = await shareGame(db, { gameId, visitorId: me });
		expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
		expect(token).not.toContain(gameId.slice(0, 8));
		expect(await shareGame(db, { gameId, visitorId: me })).toBe(token);
		expect(await shareGame(db, { gameId: await game(me), visitorId: me })).not.toBe(token);
	});

	it('shows the score, the council and the correct count, nothing else', async () => {
		const me = await visitor();
		const token = await shareGame(db, { gameId: await game(me), visitorId: me });

		expect(await sharedGame(db, token)).toEqual({
			score: 73,
			total: 10,
			correct: 8,
			council: 'N'
		});
	});

	it("refuses another visitor's game and a running one", async () => {
		const owner = await visitor();
		const gameId = await game(owner);
		await expect(shareGame(db, { gameId, visitorId: await visitor() })).rejects.toMatchObject({
			status: 404
		});
		await expect(
			shareGame(db, { gameId: await game(owner, false), visitorId: owner })
		).rejects.toMatchObject({ status: 409, key: 'game.stale' });
	});

	it('finds nothing for an unknown or malformed token', async () => {
		expect(await sharedGame(db, 'A'.repeat(22))).toBeNull();
		expect(await sharedGame(db, "x' or 1=1 --")).toBeNull();
	});
});
