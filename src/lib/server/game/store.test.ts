import { remainingMsOf } from '$lib/game/client';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RESULT_MS, ROUND_MS, ROUNDS_PER_GAME } from '$lib/game/protocol';
import { testDb } from '../../../../test/db';
import { insights } from '../analytics';
import { sql, toDate, type Db } from '../db/sqlite';
import { pruneAbandonedGames } from '../retention';
import type { DealtRound } from './deal';
import {
	answerRound,
	createGame,
	forgetGame,
	GameRefusal,
	markPhotoServed,
	replaceRound,
	startRound
} from './store';

const T = new Date('2026-11-30T08:00:00Z');
const at = (ms: number) => new Date(T.getTime() + ms);
const MEMBERS = 20;
const CROP = { size: 0.93, x: 0.5, y: 0.5, quality: 80 };

function dealt(memberId: number): DealtRound {
	const others = Array.from({ length: MEMBERS }, (_, i) => i + 1)
		.filter((id) => id !== memberId)
		.slice(0, 5);
	return { memberId, optionIds: [...others, memberId], photoCode: `p${memberId}`, crop: CROP };
}

const tenRounds = () => Array.from({ length: ROUNDS_PER_GAME }, (_, i) => dealt(i + 1));

const tokenOf = (photoUrl: string) => photoUrl.replace('/photo/', '');

async function refusalOf(promise: Promise<unknown>): Promise<GameRefusal> {
	const failure = await promise.then(
		() => null,
		(error: unknown) => error
	);
	expect(failure).toBeInstanceOf(GameRefusal);
	return failure as GameRefusal;
}

describe('game store', () => {
	let db: Db;
	let visitorId: string;

	function newVisitor(): string {
		const id = randomUUID();
		db.run(
			sql`insert into visitor (id, token_hash, created_at) values (${id}, ${Buffer.from(id)}, ${T})`
		);
		return id;
	}

	const newGame = (now = T, rounds = tenRounds()) =>
		createGame(db, { visitorId, council: 'all', language: 'fr', rounds, now });

	beforeEach(() => {
		db = testDb();
		for (let id = 1; id <= MEMBERS; id++) {
			db.run(sql`
				insert into member (id, first_name, last_name, gender, council, canton, party, photo_code, updated_at)
				values (${id}, ${`First${id}`}, ${`Last${id}`}, 'f', 'N', 'GE',
					${JSON.stringify({ de: 'SP', fr: 'PS' })}, ${`p${id}`}, ${T})
			`);
		}
		visitorId = newVisitor();
	});

	afterEach(() => db.close());

	it('counts a started game for its Zurich day, still after an abandoned game is deleted', async () => {
		const lateEvening = new Date('2026-11-30T23:30:00Z');
		await newGame(T);
		await newGame(lateEvening);
		await pruneAbandonedGames(db, new Date('2026-12-03T00:00:00Z'));

		expect(db.all(sql`select id from game`)).toHaveLength(0);
		const report = await insights(db, new Date('2026-12-01T12:00:00Z'), 2);
		expect(report.days.map((day) => [day.day, day.gamesStarted])).toEqual([
			['2026-11-30', 1],
			['2026-12-01', 1]
		]);
	});

	it('forgets a game for its owner: rounds, the day count, and the device once it has no game left', async () => {
		const first = await newGame(T);
		const second = await newGame(T);

		await forgetGame(db, { gameId: first.gameId, visitorId });
		expect(db.all(sql`select id from game`)).toEqual([{ id: second.gameId }]);
		expect(db.all(sql`select id from game_round where game_id = ${first.gameId}`)).toHaveLength(0);
		expect(db.get(sql`select id from visitor where id = ${visitorId}`)).toBeTruthy();

		await forgetGame(db, { gameId: second.gameId, visitorId });
		expect(db.get(sql`select id from visitor where id = ${visitorId}`)).toBeUndefined();
		const report = await insights(db, new Date('2026-11-30T12:00:00Z'), 1);
		expect(report.days.map((day) => day.gamesStarted)).toEqual([0]);
	});

	it("refuses to forget another visitor's game, and leaves it", async () => {
		const game = await newGame();

		const refusal = await refusalOf(
			forgetGame(db, { gameId: game.gameId, visitorId: newVisitor() })
		);
		expect(refusal.status).toBe(404);
		expect(db.get(sql`select id from game where id = ${game.gameId}`)).toBeTruthy();
	});

	it('a full game of ten right answers in 1.3 s scores 90', async () => {
		const game = await newGame();
		let now = T;
		let verdict;

		for (let index = 0; index < ROUNDS_PER_GAME; index++) {
			await startRound(db, { gameId: game.gameId, visitorId, index, now });
			now = new Date(now.getTime() + 1300);
			verdict = await answerRound(db, {
				gameId: game.gameId,
				visitorId,
				index,
				memberId: index + 1,
				now
			});
			now = new Date(now.getTime() + verdict.revealMs);
		}

		expect(verdict).toMatchObject({
			index: 9,
			score: 90,
			correctCount: 10,
			finished: true,
			next: null
		});
		const row = db.get<{ score: number; correct: number; finished_at: number }>(
			sql`select score, correct, finished_at from game where id = ${game.gameId}`
		);
		expect(row).toMatchObject({ score: 90, correct: 10 });
		expect(toDate(row?.finished_at)).toEqual(new Date(now.getTime() - RESULT_MS.right));
	});

	const unrankedOf = (gameId: string) =>
		db.get<{ unranked: string | null }>(sql`select unranked from game where id = ${gameId}`)
			?.unranked;

	async function playAll(answerAfterMs: (index: number) => number, rightUpTo = ROUNDS_PER_GAME) {
		const game = await newGame();
		let now = T;
		for (let index = 0; index < ROUNDS_PER_GAME; index++) {
			await startRound(db, { gameId: game.gameId, visitorId, index, now });
			now = new Date(now.getTime() + answerAfterMs(index));
			const memberId = index < rightUpTo ? index + 1 : null;
			const verdict = await answerRound(db, {
				gameId: game.gameId,
				visitorId,
				index,
				memberId,
				now
			});
			now = new Date(now.getTime() + verdict.revealMs);
		}
		return unrankedOf(game.gameId);
	}

	it('a game with eight right answers or more and a median under 600 ms is unranked as fast', async () => {
		expect(await playAll((index) => (index < 6 ? 550 : 2_000))).toBe('fast');
		// a deliberate miss or two no longer keeps a script ranked
		expect(await playAll(() => 350, ROUNDS_PER_GAME - 2)).toBe('fast');
	});

	it('a game at a human pace, or a fast one with three misses, stays ranked', async () => {
		expect(await playAll(() => 1_300)).toBeNull();
		expect(await playAll((index) => (index < 5 ? 550 : 650))).toBeNull();
		expect(await playAll(() => 350, ROUNDS_PER_GAME - 3)).toBeNull();
	});

	it('a game with a round answered without start is unranked as unstarted when it ends', async () => {
		const game = await newGame(T, [dealt(1), dealt(2)]);
		const ref = { gameId: game.gameId, visitorId };
		await answerRound(db, { ...ref, index: 0, memberId: null, now: at(ROUND_MS) });
		expect(unrankedOf(game.gameId)).toBeNull();

		await startRound(db, { ...ref, index: 1, now: at(ROUND_MS + RESULT_MS.wrong) });
		await answerRound(db, { ...ref, index: 1, memberId: 2, now: at(ROUND_MS + 4_000) });

		expect(unrankedOf(game.gameId)).toBe('unstarted');
	});

	it('a new game records when the device last played, for the visitor prune', async () => {
		await newGame(at(42_000));
		const row = db.get<{ last_game_at: number }>(
			sql`select last_game_at from visitor where id = ${visitorId}`
		);
		expect(toDate(row?.last_game_at)).toEqual(at(42_000));
	});

	it('startRound twice returns the same options and less time', async () => {
		const game = await newGame();
		const ref = { gameId: game.gameId, visitorId, index: 0 };

		const first = await startRound(db, { ...ref, now: at(500) });
		const second = await startRound(db, { ...ref, now: at(2500) });

		expect(second.options).toEqual(first.options);
		expect(first.remainingMs).toBe(ROUND_MS);
		expect(second.remainingMs).toBe(ROUND_MS - 2000);
		expect(second).toMatchObject({
			deadline: at(500 + ROUND_MS).getTime(),
			serverNow: at(2500).getTime()
		});
	});

	it('startRound stamps its answer at the middle of its own database work', async () => {
		const game = await newGame();
		const ref = { gameId: game.gameId, visitorId, index: 0 };

		const slow = await startRound(db, { ...ref, now: at(500), clock: () => at(6500) });

		// the browser takes half its round trip off, six seconds of work included: once in all
		expect(slow.serverNow).toBe(at(3500).getTime());
		expect(slow.remainingMs).toBe(ROUND_MS - 3000);
		const shown = remainingMsOf(slow, 6000);
		expect(shown).toBe(ROUND_MS - 6000);
	});

	it('options never carry which one is right', async () => {
		const game = await newGame();

		const round = await startRound(db, { gameId: game.gameId, visitorId, index: 0, now: T });

		expect(round.options).toHaveLength(6);
		for (const option of round.options) {
			expect(Object.keys(option).sort()).toEqual(['firstName', 'id', 'lastName', 'party']);
		}
		expect(JSON.stringify(round)).not.toContain('GE');
	});

	it('answering twice returns the stored verdict', async () => {
		const game = await newGame();
		const ref = { gameId: game.gameId, visitorId, index: 0 };
		await startRound(db, { ...ref, now: T });

		const first = await answerRound(db, { ...ref, memberId: 1, now: at(1300) });
		const second = await answerRound(db, { ...ref, memberId: 2, now: at(4000) });

		expect(second).toEqual(first);
		const row = db.get(sql`select score, correct, round_index from game where id = ${game.gameId}`);
		expect(row).toEqual({ score: 9, correct: 1, round_index: 1 });
	});

	it('two answers racing on the same round are scored once', async () => {
		const game = await newGame();
		const ref = { gameId: game.gameId, visitorId, index: 0 };
		await startRound(db, { ...ref, now: T });

		const [first, second] = await Promise.all([
			answerRound(db, { ...ref, memberId: 1, now: at(1300) }),
			answerRound(db, { ...ref, memberId: 1, now: at(1300) })
		]);

		expect(second).toEqual(first);
		const row = db.get(sql`select score, correct from game where id = ${game.gameId}`);
		expect(row).toEqual({ score: 9, correct: 1 });
	});

	it('an answer before the round is current is refused as stale', async () => {
		const game = await newGame();

		const refusal = await refusalOf(
			answerRound(db, { gameId: game.gameId, visitorId, index: 1, memberId: 2, now: T })
		);

		expect(refusal).toMatchObject({ status: 409, key: 'game.stale' });
	});

	it('a late answer scores nothing and counts as wrong', async () => {
		const game = await newGame();
		const ref = { gameId: game.gameId, visitorId, index: 0 };
		await startRound(db, { ...ref, now: T });

		const verdict = await answerRound(db, { ...ref, memberId: 1, now: at(11400) });

		expect(verdict).toMatchObject({ correct: false, points: 0, revealMs: RESULT_MS.wrong });
	});

	it('an unanswered round answered with null is wrong', async () => {
		const game = await newGame();
		const ref = { gameId: game.gameId, visitorId, index: 0 };
		await startRound(db, { ...ref, now: T });

		const verdict = await answerRound(db, { ...ref, memberId: null, now: at(ROUND_MS) });

		expect(verdict).toMatchObject({ correct: false, points: 0, score: 0, correctCount: 0 });
		expect(verdict.answer.id).toBe(1);
	});

	it('a right answer to a round never started scores nothing and counts as wrong', async () => {
		const game = await newGame();
		await markPhotoServed(db, tokenOf(game.round.photoUrl), T);

		const verdict = await answerRound(db, {
			gameId: game.gameId,
			visitorId,
			index: 0,
			memberId: 1,
			now: at(4000)
		});

		expect(verdict).toMatchObject({ correct: false, points: 0, revealMs: RESULT_MS.wrong });
		const row = db.get(sql`
			select correct, points from game_round where game_id = ${game.gameId} and round_index = 0
		`);
		expect(row).toEqual({ correct: 0, points: 0 });
	});

	it.each([1000, 2900])(
		'a right answer %i ms after the photo, without start, scores nothing',
		async (elapsed) => {
			const game = await newGame();
			await markPhotoServed(db, tokenOf(game.round.photoUrl), T);

			const verdict = await answerRound(db, {
				gameId: game.gameId,
				visitorId,
				index: 0,
				memberId: 1,
				now: at(elapsed)
			});

			expect(verdict).toMatchObject({ correct: false, points: 0, score: 0, correctCount: 0 });
			const row = db.get(sql`select score, correct from game where id = ${game.gameId}`);
			expect(row).toEqual({ score: 0, correct: 0 });
		}
	);

	it('a null answer to a round never started still ends the round', async () => {
		const game = await newGame();

		const verdict = await answerRound(db, {
			gameId: game.gameId,
			visitorId,
			index: 0,
			memberId: null,
			now: at(ROUND_MS)
		});

		expect(verdict).toMatchObject({ correct: false, points: 0, next: { index: 1 } });
	});

	it('another visitor cannot see or play the game', async () => {
		const game = await newGame();
		const stranger = newVisitor();
		const ref = { gameId: game.gameId, visitorId: stranger, index: 0, now: T };

		expect(await refusalOf(startRound(db, ref))).toMatchObject({
			status: 404,
			key: 'game.notFound'
		});
		expect(await refusalOf(answerRound(db, { ...ref, memberId: 1 }))).toMatchObject({
			status: 404,
			key: 'game.notFound'
		});
		expect(await refusalOf(replaceRound(db, { ...ref, replacement: dealt(11) }))).toMatchObject({
			status: 404,
			key: 'game.notFound'
		});
	});

	it('the next round is ready only after the reveal', async () => {
		const game = await newGame();
		const ref = { gameId: game.gameId, visitorId, index: 0 };
		await startRound(db, { ...ref, now: T });

		const verdict = await answerRound(db, { ...ref, memberId: 2, now: at(2000) });

		expect(verdict.revealMs).toBe(RESULT_MS.wrong);
		expect(verdict.next?.index).toBe(1);
		const row = db.get<{ ready_at: number }>(sql`
			select ready_at from game_round
			where photo_token = ${tokenOf(verdict.next?.photoUrl ?? '')}
		`);
		expect(toDate(row?.ready_at)).toEqual(at(5000));
	});

	it('start during the reveal is refused', async () => {
		const game = await newGame();
		const ref = { gameId: game.gameId, visitorId, index: 0 };
		await startRound(db, { ...ref, now: T });
		await answerRound(db, { ...ref, memberId: 1, now: at(1300) });
		const next = { ...ref, index: 1 };

		expect(await refusalOf(startRound(db, { ...next, now: at(1310) }))).toMatchObject({
			status: 409,
			key: 'game.stale'
		});
		const round = await startRound(db, { ...next, now: at(1300 + RESULT_MS.right) });
		expect(round.remainingMs).toBe(ROUND_MS);
	});

	it('an answer during the reveal is refused', async () => {
		const game = await newGame();
		const ref = { gameId: game.gameId, visitorId, index: 0 };
		await startRound(db, { ...ref, now: T });
		await answerRound(db, { ...ref, memberId: 1, now: at(1300) });
		const next = { ...ref, index: 1, memberId: 2 };

		expect(await refusalOf(answerRound(db, { ...next, now: at(1310) }))).toMatchObject({
			status: 409,
			key: 'game.stale'
		});
		const row = db.get(sql`
			select answered_at, clock_started_at from game_round
			where game_id = ${game.gameId} and round_index = 1 and voided_at is null
		`);
		expect(row).toEqual({ answered_at: null, clock_started_at: null });
		expect(await answerRound(db, { ...ref, memberId: 1, now: at(1310) })).toMatchObject({
			index: 0,
			correct: true
		});
	});

	it('refuses a finished game', async () => {
		const game = await newGame(T, [dealt(1)]);
		const ref = { gameId: game.gameId, visitorId, index: 0 };
		const verdict = await answerRound(db, { ...ref, memberId: 1, now: at(1000) });

		expect(verdict).toMatchObject({ finished: true, next: null });
		expect(await refusalOf(startRound(db, { ...ref, index: 1, now: at(2000) }))).toMatchObject({
			status: 409,
			key: 'game.over'
		});
	});

	it('replacing a round once marks the game unranked, a second time is refused', async () => {
		const game = await newGame();
		const ref = { gameId: game.gameId, visitorId, index: 0 };

		const replaced = await replaceRound(db, { ...ref, now: at(4000), replacement: dealt(11) });

		expect(replaced.replaced).toBe(true);
		expect(replaced.round.index).toBe(0);
		expect(replaced.round.photoUrl).not.toBe(game.round.photoUrl);
		const row = db.get(sql`select replaced, unranked from game where id = ${game.gameId}`);
		expect(row).toEqual({ replaced: 1, unranked: 'photo' });

		const round = await startRound(db, { ...ref, now: at(4500) });
		expect(round.options.map((option) => option.id)).toContain(11);
		const verdict = await answerRound(db, { ...ref, memberId: 11, now: at(5800) });
		expect(verdict).toMatchObject({ correct: true, points: 9 });

		const next = { ...ref, index: 1, now: at(7000), replacement: dealt(12) };
		expect(await refusalOf(replaceRound(db, next))).toMatchObject({
			status: 409,
			key: 'game.photoTrouble'
		});
	});

	it('a retried replacement gets the same round back and is counted once', async () => {
		const game = await newGame();
		const ref = { gameId: game.gameId, visitorId, index: 0 };
		const failedPhotoToken = tokenOf(game.round.photoUrl);

		const first = await replaceRound(db, {
			...ref,
			now: at(4000),
			replacement: dealt(11),
			failedPhotoToken
		});
		const retried = await replaceRound(db, {
			...ref,
			now: at(4200),
			replacement: dealt(12),
			failedPhotoToken
		});

		expect(retried).toEqual(first);
		const row = db.get<{ replaced: number }>(
			sql`select replaced from game where id = ${game.gameId}`
		);
		expect(row?.replaced).toBe(1);
		const rounds = db.all<{ member_id: number }>(
			sql`select member_id from game_round where game_id = ${game.gameId}`
		);
		expect(rounds.map((round) => round.member_id)).not.toContain(12);
	});

	it("a failure of the replacement's own photo is refused", async () => {
		const game = await newGame();
		const ref = { gameId: game.gameId, visitorId, index: 0 };
		const replaced = await replaceRound(db, {
			...ref,
			now: at(4000),
			replacement: dealt(11),
			failedPhotoToken: tokenOf(game.round.photoUrl)
		});

		const refusal = await refusalOf(
			replaceRound(db, {
				...ref,
				now: at(8000),
				replacement: dealt(12),
				failedPhotoToken: tokenOf(replaced.round.photoUrl)
			})
		);

		expect(refusal).toMatchObject({ status: 409, key: 'game.photoTrouble' });
	});

	it('a retried replacement of a round already started is refused', async () => {
		const game = await newGame();
		const ref = { gameId: game.gameId, visitorId, index: 0 };
		const failedPhotoToken = tokenOf(game.round.photoUrl);
		await replaceRound(db, { ...ref, now: at(4000), replacement: dealt(11), failedPhotoToken });
		await startRound(db, { ...ref, now: at(4500) });

		const refusal = await refusalOf(
			replaceRound(db, { ...ref, now: at(5000), replacement: dealt(12), failedPhotoToken })
		);

		expect(refusal).toMatchObject({ status: 409, key: 'game.photoTrouble' });
	});

	it('a started round cannot be replaced', async () => {
		const game = await newGame();
		const ref = { gameId: game.gameId, visitorId, index: 0 };
		await startRound(db, { ...ref, now: T });

		const refusal = await refusalOf(
			replaceRound(db, { ...ref, now: at(1000), replacement: dealt(11) })
		);

		expect(refusal).toMatchObject({ status: 409, key: 'game.photoTrouble' });
	});

	it('markPhotoServed keeps the first time', async () => {
		const game = await newGame();
		const token = tokenOf(game.round.photoUrl);

		expect(await markPhotoServed(db, token, at(500))).toBe(true);
		// the second time writes nothing
		expect(await markPhotoServed(db, token, at(9000))).toBe(false);

		const row = db.get<{ photo_served_at: number }>(
			sql`select photo_served_at from game_round where photo_token = ${token}`
		);
		expect(toDate(row?.photo_served_at)).toEqual(at(500));
		expect(token).toHaveLength(22);
		expect(await markPhotoServed(db, 'unknown', T)).toBe(false);
	});

	it("the verdict names the answer with party and canton in the game's language", async () => {
		const game = await newGame();

		const verdict = await answerRound(db, {
			gameId: game.gameId,
			visitorId,
			index: 0,
			memberId: 1,
			now: at(1000)
		});

		expect(verdict.answer).toEqual({
			id: 1,
			firstName: 'First1',
			lastName: 'Last1',
			party: 'PS',
			canton: 'GE'
		});
	});
});
