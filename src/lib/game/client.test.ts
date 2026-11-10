import { describe, expect, it, vi } from 'vitest';
import {
	GameError,
	fetchSummary,
	openRound,
	remainingMsOf,
	sendAnswer,
	shareScore,
	startGame
} from './client';

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const started = {
	gameId: 'g1',
	total: 10,
	council: 'all',
	round: { index: 0, photoUrl: '/p/0' }
};

const verdict = {
	index: 0,
	correct: true,
	answer: { id: 5, firstName: 'F', lastName: 'L', party: 'X', canton: 'BE' },
	points: 9,
	score: 9,
	correctCount: 1,
	next: { index: 1, photoUrl: '/photo/1' },
	finished: false,
	revealMs: 1_000
};

const truncated = () => new Response('{"index":0,"corr', { status: 200 });

describe('game client', () => {
	it('never retries a game start, which would leave an orphan game', async () => {
		const fetcher = vi
			.fn()
			.mockRejectedValueOnce(new TypeError('network'))
			.mockResolvedValueOnce(reply(started));
		const failure = await startGame(fetcher as unknown as typeof fetch, 'all', 'de').catch(
			(e) => e
		);
		expect(failure).toMatchObject({ status: 0, key: 'game.error' });
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('retries an answer once when the first request gets no response', async () => {
		const fetcher = vi
			.fn()
			.mockRejectedValueOnce(new TypeError('network'))
			.mockResolvedValueOnce(reply(verdict));
		expect(await sendAnswer(fetcher as unknown as typeof fetch, 'g1', 0, 5)).toEqual(verdict);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it('treats a cut-off 2xx body as a lost response and retries a round request once', async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(truncated())
			.mockResolvedValueOnce(reply(verdict));
		expect(await sendAnswer(fetcher as unknown as typeof fetch, 'g1', 0, 5)).toEqual(verdict);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it('refuses a 2xx body of the wrong shape on a game start, without retrying', async () => {
		for (const body of [truncated(), reply({ gameId: 'g1' }), reply(null)]) {
			const fetcher = vi.fn().mockResolvedValue(body);
			const failure = await startGame(fetcher as unknown as typeof fetch, 'all', 'de').catch(
				(e) => e
			);
			expect(failure).toMatchObject({ status: 0, key: 'game.error' });
			expect(fetcher).toHaveBeenCalledTimes(1);
		}
	});

	it.each([502, 503, 504])(
		'retries a round request once after a %i, after a short backoff',
		async (status) => {
			vi.useFakeTimers();
			try {
				const opened = { index: 0, options: [], deadline: 10_000, serverNow: 0 };
				const fetcher = vi
					.fn()
					.mockResolvedValueOnce(new Response('<html>', { status }))
					.mockResolvedValueOnce(reply(opened));
				const result = openRound(fetcher as unknown as typeof fetch, 'g1', 0);
				await vi.advanceTimersByTimeAsync(299);
				expect(fetcher).toHaveBeenCalledTimes(1);
				await vi.advanceTimersByTimeAsync(501);
				expect(fetcher).toHaveBeenCalledTimes(2);
				expect(await result).toMatchObject({ index: 0, remainingMs: 10_000 });
			} finally {
				vi.useRealTimers();
			}
		}
	);

	it('gives up after a second gateway error, and never retries a game start on one', async () => {
		vi.useFakeTimers();
		try {
			const failing = vi.fn().mockResolvedValue(reply({ message: 'game.error' }, 503));
			const answer = sendAnswer(failing as unknown as typeof fetch, 'g1', 0, 5).catch((e) => e);
			await vi.advanceTimersByTimeAsync(800);
			expect(await answer).toMatchObject({ status: 503 });
			expect(failing).toHaveBeenCalledTimes(2);

			const starting = vi.fn().mockResolvedValue(new Response('<html>', { status: 502 }));
			const start = startGame(starting as unknown as typeof fetch, 'all', 'de').catch((e) => e);
			await vi.advanceTimersByTimeAsync(800);
			expect(await start).toMatchObject({ status: 502 });
			expect(starting).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not retry a 429 or a 500', async () => {
		for (const status of [429, 500]) {
			const fetcher = vi.fn().mockResolvedValue(reply({ message: 'game.tooFast' }, status));
			await sendAnswer(fetcher as unknown as typeof fetch, 'g1', 0, 5).catch((e) => e);
			expect(fetcher).toHaveBeenCalledTimes(1);
		}
	});

	it('does not retry a 409', async () => {
		const fetcher = vi.fn().mockResolvedValue(reply({ message: 'game.stale' }, 409));
		const failure = await sendAnswer(fetcher as unknown as typeof fetch, 'g1', 0, 5).catch(
			(e) => e
		);
		expect(failure).toBeInstanceOf(GameError);
		expect(failure).toMatchObject({ status: 409, key: 'game.stale' });
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('gives up after a second silent failure with status 0', async () => {
		const fetcher = vi.fn().mockRejectedValue(new TypeError('network'));
		const failure = await openRound(fetcher as unknown as typeof fetch, 'g1', 0).catch((e) => e);
		expect(failure).toMatchObject({ status: 0, key: 'game.error' });
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it('maps unknown or non-JSON error bodies to game.error', async () => {
		const unknownKey = vi.fn().mockResolvedValue(reply({ message: 'nope' }, 500));
		const notJson = vi.fn().mockResolvedValue(new Response('<html>', { status: 502 }));
		expect(await startGame(unknownKey as never, 'N', 'fr').catch((e) => e)).toMatchObject({
			status: 500,
			key: 'game.error'
		});
		expect(await startGame(notJson as never, 'N', 'fr').catch((e) => e)).toMatchObject({
			status: 502,
			key: 'game.error'
		});
	});

	it('sends the photoFailed flag with the photo that failed', async () => {
		const fetcher = vi.fn().mockResolvedValue(reply({ replaced: true, round: started.round }));
		await openRound(fetcher as unknown as typeof fetch, 'g1', 2, '/photo/abc');
		expect(fetcher.mock.calls[0][0]).toBe('/api/game/g1/round/2/start');
		expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
			photoFailed: true,
			photoUrl: '/photo/abc',
			attempt: expect.stringMatching(/^[A-Za-z0-9-]{8,64}$/)
		});
	});

	it('sends a failed photo again with the same attempt when the response was lost, and a new attempt next time', async () => {
		const fetcher = vi
			.fn()
			.mockRejectedValueOnce(new TypeError('network'))
			.mockImplementation(async () => reply({ replaced: true, round: started.round }));
		await openRound(fetcher as unknown as typeof fetch, 'g1', 2, '/photo/abc');
		await openRound(fetcher as unknown as typeof fetch, 'g1', 2, '/photo/abc');

		const attempts = fetcher.mock.calls.map((call) => JSON.parse(call[1].body).attempt);
		expect(attempts).toHaveLength(3);
		expect(attempts[1]).toBe(attempts[0]);
		expect(attempts[2]).not.toBe(attempts[0]);
	});

	it('fetchSummary returns the summary', async () => {
		const summary = { betterThan: 40, best: 70, games: 3, newBest: false };
		const fetcher = vi.fn().mockResolvedValue(reply(summary));
		expect(await fetchSummary(fetcher as unknown as typeof fetch, 'g1')).toEqual(summary);
		expect(fetcher.mock.calls[0][0]).toBe('/api/game/g1/summary');
	});

	it('fetchSummary returns null on failure', async () => {
		const refused = vi.fn().mockResolvedValue(reply({ message: 'game.notFound' }, 404));
		expect(await fetchSummary(refused as unknown as typeof fetch, 'g1')).toBeNull();
		const offline = vi.fn().mockRejectedValue(new TypeError('network'));
		expect(await fetchSummary(offline as unknown as typeof fetch, 'g1')).toBeNull();
		expect(offline).toHaveBeenCalledTimes(1);
	});

	it('shareScore posts once and returns the token, or null on failure', async () => {
		const fetcher = vi.fn().mockResolvedValue(reply({ token: 'abc' }));
		expect(await shareScore(fetcher as unknown as typeof fetch, 'g1')).toBe('abc');
		expect(fetcher.mock.calls[0][0]).toBe('/api/game/g1/share');
		expect(fetcher.mock.calls[0][1].method).toBe('POST');

		const refused = vi.fn().mockResolvedValue(reply({ message: 'game.stale' }, 409));
		expect(await shareScore(refused as unknown as typeof fetch, 'g1')).toBeNull();
	});

	it('counts the time left from the server deadline, minus half the round trip', () => {
		const serverNow = 1_800_000_000_000;
		expect(remainingMsOf({ deadline: serverNow + 6_000, serverNow }, 400)).toBe(5_800);
		expect(remainingMsOf({ deadline: serverNow + 6_000, serverNow }, -50)).toBe(6_000);
		expect(remainingMsOf({ deadline: serverNow + 60_000, serverNow }, 0)).toBe(10_000);
		expect(remainingMsOf({ deadline: serverNow - 500, serverNow }, 100)).toBe(0);
	});

	it('openRound gives a slow response less time than the server has left', async () => {
		vi.useFakeTimers();
		try {
			const serverNow = 1_800_000_000_000;
			const body = { index: 0, options: [], deadline: serverNow + 9_000, serverNow };
			const fetcher = vi.fn(
				() => new Promise<Response>((resolve) => setTimeout(() => resolve(reply(body)), 600))
			);
			const opened = openRound(fetcher as unknown as typeof fetch, 'g1', 0);
			await vi.advanceTimersByTimeAsync(600);
			expect(await opened).toEqual({ index: 0, options: [], remainingMs: 8_700 });
		} finally {
			vi.useRealTimers();
		}
	});

	it('openRound falls back to remainingMs when an older server sends no deadline', async () => {
		vi.useFakeTimers();
		try {
			const body = { index: 0, options: [], remainingMs: 9_000 };
			const fetcher = vi.fn(
				() => new Promise<Response>((resolve) => setTimeout(() => resolve(reply(body)), 600))
			);
			const opened = openRound(fetcher as unknown as typeof fetch, 'g1', 0);
			await vi.advanceTimersByTimeAsync(600);
			expect(await opened).toEqual({ index: 0, options: [], remainingMs: 8_700 });
			expect(fetcher).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('openRound still treats a round without deadline nor remainingMs as a lost response', async () => {
		const fetcher = vi.fn().mockResolvedValue(reply({ index: 0, options: [] }));
		const failure = await openRound(fetcher as unknown as typeof fetch, 'g1', 0).catch((e) => e);
		expect(failure).toMatchObject({ status: 0, key: 'game.error' });
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it('startGame keeps the council it asked for when an older server leaves it out', async () => {
		const previous = { gameId: started.gameId, total: started.total, round: started.round };
		const fetcher = vi.fn().mockResolvedValue(reply(previous));
		expect(await startGame(fetcher as unknown as typeof fetch, 'S', 'de')).toEqual({
			...previous,
			council: 'S'
		});
	});

	it('startGame takes the council the server returns over the one it sent', async () => {
		const fetcher = vi.fn().mockResolvedValue(reply(started));
		expect(await startGame(fetcher as unknown as typeof fetch, 'S', 'de')).toEqual(started);
	});

	it('startGame still accepts a reply that carries the retired timed field', async () => {
		const fetcher = vi.fn().mockResolvedValue(reply({ ...started, timed: false }));
		expect(await startGame(fetcher as unknown as typeof fetch, 'all', 'de')).toMatchObject(started);
	});
});
