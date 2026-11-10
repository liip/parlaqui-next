import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUNDS_PER_GAME, ROUND_MS } from '$lib/game/protocol';
import type { OpenRound, ReplacedRound, StartedGame, Verdict } from '$lib/game/protocol';
import { sql } from '$lib/server/db/sqlite';

const T = new Date('2026-11-30T08:00:00Z');
const MEMBERS = 20;

// the routes read the shared database, so this file makes it one in memory before importing them
process.env.DATABASE_PATH = ':memory:';

const { db } = await import('$lib/server/db');
const { migrate } = await import('$lib/server/db/migrate');
const { VISITOR_COOKIE, findVisitor } = await import('$lib/server/visitor');
const { rememberBusy } = await import('$lib/server/photo/busy');
const { POST: createGame } = await import('./+server');
const { POST: startRound } = await import('./[id]/round/[index]/start/+server');
const { POST: answerRound } = await import('./[id]/round/[index]/answer/+server');
const { GET: summaryOf } = await import('./[id]/summary/+server');
const { POST: shareOf } = await import('./[id]/share/+server');
const { DELETE: forgetOf } = await import('./[id]/+server');

type Handler = (event: never) => Promise<Response>;

const cookieJar = new Map<string, string>();
const cookies = {
	get: (name: string) => cookieJar.get(name),
	set: (name: string, value: string) => void cookieJar.set(name, value)
};

async function post(
	handler: unknown,
	body: unknown,
	params: Record<string, string> = {},
	{ withCookie = true, as }: { withCookie?: boolean; as?: string } = {}
): Promise<Response> {
	const token = withCookie ? cookieJar.get(VISITOR_COOKIE) : undefined;
	const event = {
		request: new Request('http://localhost/api', {
			method: 'POST',
			body: typeof body === 'string' ? body : JSON.stringify(body)
		}),
		params,
		cookies: {
			get: (name: string) => (withCookie ? cookies.get(name) : undefined),
			set: cookies.set
		},
		locals: { visitorId: as ?? (await findVisitor(db, token)) }
	};
	return (handler as Handler)(event as never);
}

const startGame = async (): Promise<StartedGame> =>
	(await post(createGame, { council: 'all', language: 'fr' })).json();

async function summary_(
	gameId: string,
	{ withCookie = true, as }: { withCookie?: boolean; as?: string } = {}
): Promise<Response> {
	const token = withCookie ? cookieJar.get(VISITOR_COOKIE) : undefined;
	const visitorId = as ?? (withCookie ? await findVisitor(db, token) : null);
	return (summaryOf as Handler)({ params: { id: gameId }, locals: { visitorId } } as never);
}

const start = (gameId: string, index: number, body: unknown = {}) =>
	post(startRound, body, { id: gameId, index: String(index) });

const answer = (gameId: string, index: number, memberId: number | null) =>
	post(answerRound, { memberId }, { id: gameId, index: String(index) });

async function answerOf(gameId: string, index: number): Promise<number> {
	const row = db.get<{ member_id: number }>(sql`
		select member_id from game_round
		where game_id = ${gameId} and round_index = ${index} and voided_at is null
	`);
	return row!.member_id;
}

const GAME_URL = (id: string, index: number) => ({ id, index: String(index) });

beforeAll(async () => {
	migrate(db);
	vi.useFakeTimers({ toFake: ['Date'] });
});

beforeEach(async () => {
	vi.setSystemTime(T);
	cookieJar.clear();
	db.exec('delete from game_round; delete from game; delete from visitor; delete from member');
	for (let id = 1; id <= MEMBERS; id++) {
		db.run(sql`
			insert into member (id, first_name, last_name, gender, council, canton, party, photo_code, updated_at)
			values (${id}, ${`First${id}`}, ${`Last${id}`}, 'f', 'N', 'GE',
				${JSON.stringify({ de: 'SP', fr: 'PS' })}, ${`p${id}`}, ${T})
		`);
	}
});

afterEach(() => vi.setSystemTime(T));

afterAll(async () => {
	vi.useRealTimers();
	db.close();
});

describe('game routes', () => {
	it('plays a whole game through the three routes', async () => {
		const game = await startGame();
		expect(game).toMatchObject({ total: ROUNDS_PER_GAME, council: 'all' });

		let verdict: Verdict | undefined;
		for (let index = 0; index < ROUNDS_PER_GAME; index++) {
			const opened = await start(game.gameId, index);
			expect(opened.status).toBe(200);
			const round: OpenRound = await opened.json();
			expect(round.options).toHaveLength(6);

			vi.setSystemTime(new Date(Date.now() + 1_000));
			const response = await answer(game.gameId, index, await answerOf(game.gameId, index));
			expect(response.status).toBe(200);
			verdict = await response.json();
			expect(verdict?.correct).toBe(true);
			vi.setSystemTime(new Date(Date.now() + 3_100));
		}
		expect(verdict?.finished).toBe(true);
		expect(verdict?.score).toBeGreaterThan(0);
		expect(verdict?.score).toBeLessThanOrEqual(100);

		const summary = await summary_(game.gameId);
		expect(summary.status).toBe(200);
		expect(summary.headers.get('cache-control')).toBe('no-store');
		expect(await summary.json()).toEqual({
			betterThan: null,
			best: verdict?.score,
			games: 1,
			newBest: false,
			average: verdict?.score,
			previousAverage: null
		});
		expect((await summary_(game.gameId, { as: randomUUID() })).status).toBe(404);

		const shared = await post(shareOf, {}, { id: game.gameId });
		expect(shared.status).toBe(200);
		expect((await shared.json()).token).toMatch(/^[A-Za-z0-9_-]{22}$/);
		expect((await post(shareOf, {}, { id: game.gameId }, { as: randomUUID() })).status).toBe(404);
	});

	it('the summary answers 409 for a running game and 404 for a malformed id', async () => {
		const game = await startGame();
		expect(await (await summary_(game.gameId)).json()).toEqual({ message: 'game.stale' });
		expect((await summary_(game.gameId)).status).toBe(409);
		expect((await summary_('nope')).status).toBe(404);
		expect((await summary_(game.gameId, { withCookie: false })).status).toBe(404);
	});

	it('DELETE forgets a game for its owner only, once, and 404s a malformed id or a missing cookie', async () => {
		const game = await startGame();
		const owner = await findVisitor(db, cookieJar.get(VISITOR_COOKIE));
		const forget = (id: string, visitorId: string | null) =>
			(forgetOf as Handler)({ params: { id }, locals: { visitorId } } as never);

		expect((await forget('nope', owner)).status).toBe(404);
		expect((await forget(game.gameId, null)).status).toBe(404);
		expect((await forget(game.gameId, randomUUID())).status).toBe(404);
		expect((await summary_(game.gameId)).status).toBe(409);

		expect((await forget(game.gameId, owner)).status).toBe(204);
		expect((await forget(game.gameId, owner)).status).toBe(404);
		expect((await summary_(game.gameId, { as: owner! })).status).toBe(404);
	});

	it('ignores a timed flag: a page loaded before the deploy that asks for a game without a time limit gets a timed one', async () => {
		const game: StartedGame = await (
			await post(createGame, { council: 'N', language: 'fr', timed: false })
		).json();
		expect(game).toMatchObject({ council: 'N' });
		expect(game).not.toHaveProperty('timed');
		const opened: OpenRound = await (await start(game.gameId, 0)).json();
		expect(opened.deadline).toBeGreaterThan(opened.serverNow);
		expect(opened).not.toHaveProperty('timed');
	});

	it('refuses an unknown council with 400', async () => {
		const response = await post(createGame, { council: 'X', language: 'fr' });
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ message: 'game.error' });
	});

	it('refuses a body that is not an object with 400', async () => {
		expect((await post(createGame, '[1]')).status).toBe(400);
		expect((await post(createGame, 'nope')).status).toBe(400);
	});

	it('answers 503 with game.noData on an empty roster', async () => {
		db.exec('delete from game_round; delete from member');
		const response = await post(createGame, { council: 'all', language: 'fr' });
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ message: 'game.noData' });
		expect(cookieJar.size).toBe(0);
	});

	it('a request without the visitor cookie gets 404', async () => {
		const game = await startGame();
		const response = await post(startRound, {}, GAME_URL(game.gameId, 0), { withCookie: false });
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ message: 'game.notFound' });
	});

	it('answers 404 for a malformed id instead of a 500, and 400 for a bad index', async () => {
		await startGame();
		expect((await post(startRound, {}, { id: 'not-a-uuid', index: '0' })).status).toBe(404);
		const id = '11111111-1111-4111-8111-111111111111';
		expect((await post(startRound, {}, { id, index: '10' })).status).toBe(400);
		expect((await post(startRound, {}, { id, index: 'x' })).status).toBe(400);
		expect((await post(startRound, {}, { id, index: '0' })).status).toBe(404);
	});

	it('answers after the round expired score nothing', async () => {
		const game = await startGame();
		await start(game.gameId, 0);
		vi.setSystemTime(new Date(Date.now() + ROUND_MS + 2_000));
		const verdict: Verdict = await (
			await answer(game.gameId, 0, await answerOf(game.gameId, 0))
		).json();
		expect(verdict.correct).toBe(false);
		expect(verdict.points).toBe(0);
	});

	it('a repeated answer gets the same verdict', async () => {
		const game = await startGame();
		await start(game.gameId, 0);
		vi.setSystemTime(new Date(Date.now() + 1_000));
		const memberId = await answerOf(game.gameId, 0);
		const first = await (await answer(game.gameId, 0, memberId)).json();
		vi.setSystemTime(new Date(Date.now() + 500));
		const second = await (await answer(game.gameId, 0, null)).json();
		expect(second).toEqual(first);
	});

	it('photoFailed replaces the round with someone not yet dealt', async () => {
		const game = await startGame();
		const before = db.all(sql`select member_id from game_round where game_id = ${game.gameId}`);
		const dealt = new Set(before.map((row) => row.member_id));

		const response = await start(game.gameId, 0, { photoFailed: true });
		expect(response.status).toBe(200);
		const replaced: ReplacedRound = await response.json();
		expect(replaced.replaced).toBe(true);
		expect(replaced.round.photoUrl).not.toBe(game.round.photoUrl);
		expect(dealt.has(await answerOf(game.gameId, 0))).toBe(false);
	});

	it('a retried photoFailed gets the same replacement', async () => {
		const game = await startGame();
		const body = { photoFailed: true, photoUrl: game.round.photoUrl };

		const first: ReplacedRound = await (await start(game.gameId, 0, body)).json();
		const retried = await start(game.gameId, 0, body);

		expect(retried.status).toBe(200);
		expect(await retried.json()).toEqual(first);
	});

	it('photoFailed on a photo refused for load hands back the same round, once, and keeps the replacement', async () => {
		const game = await startGame();
		const body = { photoFailed: true, photoUrl: game.round.photoUrl };
		rememberBusy(game.round.photoUrl.replace('/photo/', ''));

		const again: ReplacedRound = await (await start(game.gameId, 0, body)).json();
		expect(again).toEqual({ replaced: true, round: game.round });
		const kept = db.get(sql`select replaced, unranked from game where id = ${game.gameId}`);
		expect(kept).toEqual({ replaced: 0, unranked: null });

		const replaced: ReplacedRound = await (await start(game.gameId, 0, body)).json();
		expect(replaced.round.photoUrl).not.toBe(game.round.photoUrl);
		const spent = db.get(sql`select replaced, unranked from game where id = ${game.gameId}`);
		expect(spent).toEqual({ replaced: 1, unranked: 'photo' });
	});

	it('the same busy attempt sent again after a lost response keeps the round and the replacement', async () => {
		const game = await startGame();
		const body = { photoFailed: true, photoUrl: game.round.photoUrl, attempt: 'attempt-one' };
		rememberBusy(game.round.photoUrl.replace('/photo/', ''));

		for (let i = 0; i < 2; i++) {
			const again: ReplacedRound = await (await start(game.gameId, 0, body)).json();
			expect(again).toEqual({ replaced: true, round: game.round });
		}
		const kept = db.get(sql`select replaced, unranked from game where id = ${game.gameId}`);
		expect(kept).toEqual({ replaced: 0, unranked: null });

		const replaced: ReplacedRound = await (
			await start(game.gameId, 0, { ...body, attempt: 'attempt-two' })
		).json();
		expect(replaced.round.photoUrl).not.toBe(game.round.photoUrl);
	});

	it("a failure of the replacement's photo answers 409 game.photoTrouble", async () => {
		const game = await startGame();
		const replaced: ReplacedRound = await (
			await start(game.gameId, 0, { photoFailed: true, photoUrl: game.round.photoUrl })
		).json();

		const response = await start(game.gameId, 0, {
			photoFailed: true,
			photoUrl: replaced.round.photoUrl
		});

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ message: 'game.photoTrouble' });
	});

	it('the start response holds no answer id field', async () => {
		const game = await startGame();
		const opened = await (await start(game.gameId, 0)).json();
		expect(Object.keys(opened).sort()).toEqual([
			'deadline',
			'index',
			'options',
			'remainingMs',
			'serverNow'
		]);
		// measured when the answer leaves, so the database work of this start is already spent
		expect(opened.deadline - opened.serverNow).toBeLessThanOrEqual(ROUND_MS);
		expect(opened.deadline - opened.serverNow).toBeGreaterThan(ROUND_MS - 1000);
		expect(JSON.stringify(game)).not.toMatch(/memberId|answer/);
	});

	describe('another visitor', () => {
		let other: string;

		beforeEach(async () => {
			other = randomUUID();
			db.run(
				sql`insert into visitor (id, token_hash, created_at) values (${other}, ${Buffer.from(other)}, ${T})`
			);
		});

		it('gets 404 game.notFound on start, answer and photoFailed', async () => {
			const game = await startGame();
			const params = GAME_URL(game.gameId, 0);
			const responses = [
				await post(startRound, {}, params, { as: other }),
				await post(startRound, { photoFailed: true }, params, { as: other }),
				await post(answerRound, { memberId: 1 }, params, { as: other })
			];
			for (const response of responses) {
				expect(response.status).toBe(404);
				expect(await response.json()).toEqual({ message: 'game.notFound' });
			}
		});
	});

	describe('answer validation', () => {
		it.each([
			['"3"', { memberId: '3' }],
			['1.5', { memberId: 1.5 }],
			['missing', {}],
			['0', { memberId: 0 }],
			['out of int range', { memberId: 2_147_483_648 }]
		])('refuses memberId %s with 400', async (_label, body) => {
			const game = await startGame();
			const response = await post(answerRound, body, GAME_URL(game.gameId, 0));
			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({ message: 'game.error' });
		});

		it('answers 404 for a malformed id and 400 for a bad index', async () => {
			await startGame();
			expect((await post(answerRound, { memberId: 1 }, { id: 'nope', index: '0' })).status).toBe(
				404
			);
			const id = '11111111-1111-4111-8111-111111111111';
			expect((await post(answerRound, { memberId: 1 }, { id, index: '10' })).status).toBe(400);
			expect((await post(answerRound, { memberId: 1 }, { id, index: '-1' })).status).toBe(400);
		});
	});

	it('photoFailed answers 409 game.photoTrouble when every playable member is already dealt', async () => {
		const game = await startGame();
		db.run(sql`
			delete from member where id not in (select member_id from game_round where game_id = ${game.gameId})
		`);
		const response = await start(game.gameId, 0, { photoFailed: true });
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ message: 'game.photoTrouble' });
	});
});
