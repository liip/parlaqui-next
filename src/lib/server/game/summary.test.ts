import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testDb } from '../../../../test/db';
import { sql, type Db } from '../db/sqlite';
import { GameRefusal } from './store';
import { HISTOGRAM_TTL_MS, createHistograms, gameSummary, type Histograms } from './summary';

const IN_MONTH = new Date('2026-11-10T10:00:00Z');
const LATER = new Date('2027-01-01T00:00:00Z');

type Finished = {
	visitorId: string;
	council?: 'all' | 'N' | 'S';
	score: number;
	finishedAt?: Date | null;
	unranked?: 'photo' | 'fast' | 'unstarted' | null;
};

describe('gameSummary', () => {
	let db: Db;
	let histograms: Histograms;

	const summarise = (ref: { gameId: string; visitorId: string }, now = LATER) =>
		gameSummary(db, { ...ref, now, histograms });

	async function visitor(): Promise<string> {
		const id = randomUUID();
		db.run(sql`
			insert into visitor (id, token_hash, created_at) values (${id}, ${randomBytes(32)}, ${IN_MONTH})
		`);
		return id;
	}

	async function finishedGame({
		visitorId,
		council = 'all',
		score,
		finishedAt = IN_MONTH,
		unranked = null
	}: Finished): Promise<string> {
		const id = randomUUID();
		db.run(sql`
			insert into game (id, visitor_id, council, language, total, round_index, score, unranked,
				started_at, finished_at)
			values (${id}, ${visitorId}, ${council}, 'fr', 10, 10, ${score}, ${unranked},
				${finishedAt ?? IN_MONTH}, ${finishedAt})
		`);
		return id;
	}

	// one device per score: the month counts take each device's best only
	async function others(scores: number[], extra: Partial<Finished> = {}) {
		for (const score of scores) await finishedGame({ visitorId: await visitor(), score, ...extra });
	}

	const tens = Array.from({ length: 10 }, (_, i) => (i + 1) * 10);

	beforeEach(() => {
		db = testDb();
		histograms = createHistograms();
	});

	afterEach(() => db.close());

	it('counts strictly lower scores only', async () => {
		await others(tens);
		const me = await visitor();
		const gameId = await finishedGame({ visitorId: me, score: 50 });

		expect((await summarise({ gameId, visitorId: me })).betterThan).toBe(40);
	});

	it('hides the percentile below ten comparison games', async () => {
		await others(tens.slice(0, 9));
		const me = await visitor();
		const gameId = await finishedGame({ visitorId: me, score: 100 });

		expect((await summarise({ gameId, visitorId: me })).betterThan).toBeNull();
	});

	it('hides a zero percentile', async () => {
		await others(Array(10).fill(0));
		const me = await visitor();
		const gameId = await finishedGame({ visitorId: me, score: 0 });

		expect((await summarise({ gameId, visitorId: me })).betterThan).toBeNull();
	});

	it('only compares the same council and ranked finished games', async () => {
		await others(tens);
		await others(Array(10).fill(0), { council: 'N' });
		await others(Array(10).fill(0), { unranked: 'photo' });
		await others(Array(10).fill(0), { finishedAt: null });
		const me = await visitor();
		const gameId = await finishedGame({ visitorId: me, score: 50 });

		expect((await summarise({ gameId, visitorId: me })).betterThan).toBe(40);
	});

	it('leaves out every unranked reason', async () => {
		await others(tens);
		for (const unranked of ['photo', 'fast', 'unstarted'] as const) {
			await others(Array(10).fill(0), { unranked });
		}
		const me = await visitor();
		const gameId = await finishedGame({ visitorId: me, score: 50 });

		expect((await summarise({ gameId, visitorId: me })).betterThan).toBe(40);
	});

	it('reuses the month counts for a minute, without counting a game finished after them', async () => {
		await others(tens);
		const first = await visitor();
		const firstGame = await finishedGame({ visitorId: first, score: 0 });
		const takenAt = new Date(IN_MONTH.getTime() + 1_000);
		await summarise({ gameId: firstGame, visitorId: first }, takenAt);

		const me = await visitor();
		const finishedAt = new Date(takenAt.getTime() + 1_000);
		const gameId = await finishedGame({ visitorId: me, score: 50, finishedAt });
		await others(Array(10).fill(100), { finishedAt });

		const cached = await summarise(
			{ gameId, visitorId: me },
			new Date(finishedAt.getTime() + 1_000)
		);
		// eleven games counted: the ten tens and the first game at 0, five of them lower than 50
		expect(cached.betterThan).toBe(45);

		const fresh = await summarise(
			{ gameId, visitorId: me },
			new Date(takenAt.getTime() + HISTOGRAM_TTL_MS)
		);
		expect(fresh.betterThan).toBe(23);
	});

	it('counts each device once, with its best game of the month', async () => {
		await others(tens);
		const script = await visitor();
		for (let i = 0; i < 50; i++) await finishedGame({ visitorId: script, score: 0 });
		const me = await visitor();
		const gameId = await finishedGame({ visitorId: me, score: 50 });

		// eleven devices: the ten tens and the script at 0, five of them lower than 50
		expect((await summarise({ gameId, visitorId: me })).betterThan).toBe(45);
	});

	it("compares a device's weaker game with the others, not with its own best", async () => {
		await others(tens);
		const me = await visitor();
		await finishedGame({ visitorId: me, score: 90 });
		const gameId = await finishedGame({ visitorId: me, score: 50 });

		expect((await summarise({ gameId, visitorId: me })).betterThan).toBe(40);
	});

	it("takes the device's cached entry out of the lower scores too", async () => {
		await others(tens);
		const me = await visitor();
		const first = await finishedGame({ visitorId: me, score: 0 });
		const takenAt = new Date(IN_MONTH.getTime() + 1_000);
		await summarise({ gameId: first, visitorId: me }, takenAt);

		const finishedAt = new Date(takenAt.getTime() + 1_000);
		const gameId = await finishedGame({ visitorId: me, score: 50, finishedAt });
		const cached = await summarise({ gameId, visitorId: me }, new Date(finishedAt.getTime() + 1));

		// the counts still hold this device at 0; against the ten others, 50 beats four
		expect(cached.betterThan).toBe(40);
	});

	it('never reads above 100 % when the game is missing from cached counts', async () => {
		await others(Array(11).fill(0));
		const first = await visitor();
		const firstGame = await finishedGame({ visitorId: first, score: 0 });
		const takenAt = new Date(IN_MONTH.getTime() + 1_000);
		await summarise({ gameId: firstGame, visitorId: first }, takenAt);
		// finished before the counts were taken, committed after them
		const me = await visitor();
		const gameId = await finishedGame({ visitorId: me, score: 100, finishedAt: IN_MONTH });

		const summary = await summarise({ gameId, visitorId: me }, new Date(takenAt.getTime() + 1_000));
		expect(summary.betterThan).toBe(100);
	});

	it('rounds the percentile down', async () => {
		await others([...Array(6).fill(0), ...Array(5).fill(90)]);
		const me = await visitor();
		const gameId = await finishedGame({ visitorId: me, score: 50 });

		expect((await summarise({ gameId, visitorId: me })).betterThan).toBe(54);
	});

	it('uses the Zurich month in summer time too', async () => {
		const finishedAt = new Date('2026-08-01T08:00:00Z');
		await others(Array(10).fill(0), { finishedAt: new Date('2026-07-31T22:30:00Z') });
		await others(Array(10).fill(0), { finishedAt: new Date('2026-07-31T21:30:00Z') });
		const me = await visitor();
		const gameId = await finishedGame({ visitorId: me, score: 50, finishedAt });

		expect((await summarise({ gameId, visitorId: me })).betterThan).toBe(100);
	});

	it('compares with the month the game finished in', async () => {
		await others(Array(10).fill(0), { finishedAt: new Date('2026-10-20T10:00:00Z') });
		const me = await visitor();
		const gameId = await finishedGame({
			visitorId: me,
			score: 50,
			finishedAt: new Date('2026-10-31T22:59:00Z')
		});

		expect((await summarise({ gameId, visitorId: me })).betterThan).toBe(100);
	});

	it('leaves out the games of the next month', async () => {
		await others(Array(10).fill(0));
		await others(Array(10).fill(100), { finishedAt: new Date('2026-12-02T10:00:00Z') });
		await others(Array(10).fill(100), { finishedAt: new Date('2026-11-30T23:30:00Z') });
		const me = await visitor();
		const gameId = await finishedGame({ visitorId: me, score: 50 });

		expect((await summarise({ gameId, visitorId: me })).betterThan).toBe(100);
	});

	it('uses the Zurich month', async () => {
		const finishedAt = new Date('2026-11-01T08:00:00Z');
		await others(Array(10).fill(0), { finishedAt: new Date('2026-10-31T23:30:00Z') });
		await others(Array(10).fill(0), { finishedAt: new Date('2026-10-31T22:30:00Z') });
		const me = await visitor();
		const gameId = await finishedGame({ visitorId: me, score: 50, finishedAt });

		const summary = await summarise({ gameId, visitorId: me });
		expect(summary.betterThan).toBe(100);

		db.run(sql`delete from game where finished_at = ${new Date('2026-10-31T23:30:00Z')}`);
		histograms.clear();
		expect((await summarise({ gameId, visitorId: me })).betterThan).toBeNull();
	});

	it("gives the visitor's best, count and newBest within the same council", async () => {
		const me = await visitor();
		await finishedGame({ visitorId: me, score: 30 });
		await finishedGame({ visitorId: me, score: 90, council: 'S' });
		const record = await finishedGame({ visitorId: me, score: 70 });

		expect(await summarise({ gameId: record, visitorId: me })).toMatchObject({
			best: 70,
			games: 2,
			newBest: true
		});

		const tie = await finishedGame({ visitorId: me, score: 70 });
		expect(await summarise({ gameId: tie, visitorId: me })).toMatchObject({
			best: 70,
			games: 3,
			newBest: false
		});

		const weaker = await finishedGame({ visitorId: me, score: 40 });
		expect(await summarise({ gameId: weaker, visitorId: me })).toMatchObject({
			best: 70,
			games: 4,
			newBest: false
		});

		const newcomer = await visitor();
		const first = await finishedGame({ visitorId: newcomer, score: 40 });
		expect(await summarise({ gameId: first, visitorId: newcomer })).toEqual({
			betterThan: null,
			best: 40,
			games: 1,
			newBest: false,
			average: 40,
			previousAverage: null
		});
	});

	it('gives the mean before this game and the mean including it, rounded, same council only', async () => {
		const me = await visitor();
		await finishedGame({ visitorId: me, score: 40, finishedAt: new Date('2026-11-01T10:00:00Z') });
		await finishedGame({ visitorId: me, score: 45, finishedAt: new Date('2026-11-02T10:00:00Z') });
		await finishedGame({ visitorId: me, score: 0, council: 'N' });
		const gameId = await finishedGame({ visitorId: me, score: 90 });
		const stranger = await visitor();
		await finishedGame({ visitorId: stranger, score: 0 });

		expect(await summarise({ gameId, visitorId: me })).toMatchObject({
			previousAverage: 43,
			average: 58
		});
	});

	it('an unranked game gets no percentile but counts for the device', async () => {
		await others(tens);
		const me = await visitor();
		const gameId = await finishedGame({ visitorId: me, score: 90, unranked: 'photo' });

		expect(await summarise({ gameId, visitorId: me })).toEqual({
			betterThan: null,
			best: 90,
			games: 1,
			newBest: false,
			average: 90,
			previousAverage: null
		});
	});

	it("refuses another visitor's game", async () => {
		const owner = await visitor();
		const gameId = await finishedGame({ visitorId: owner, score: 50 });
		const stranger = await visitor();

		const refusal = summarise({ gameId, visitorId: stranger });
		await expect(refusal).rejects.toBeInstanceOf(GameRefusal);
		await expect(refusal).rejects.toMatchObject({ status: 404, key: 'game.notFound' });
		await expect(summarise({ gameId: randomUUID(), visitorId: owner })).rejects.toMatchObject({
			status: 404
		});
	});

	it('refuses a running game', async () => {
		const me = await visitor();
		const gameId = await finishedGame({ visitorId: me, score: 20, finishedAt: null });

		await expect(summarise({ gameId, visitorId: me })).rejects.toMatchObject({
			status: 409,
			key: 'game.stale'
		});
	});
});
