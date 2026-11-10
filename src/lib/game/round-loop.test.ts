import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoundLoop, type LoopState } from './round-loop';
import type { OpenRound, PublicOption, StartedGame, Verdict } from './protocol';

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const option = (id: number): PublicOption => ({
	id,
	firstName: `F${id}`,
	lastName: `L${id}`,
	party: 'X'
});

const game = (total = 10): StartedGame => ({
	gameId: 'g1',
	total,
	council: 'all',
	round: { index: 0, photoUrl: '/photo/0' }
});

const SERVER_NOW = 1_800_000_000_000;

const open = (index: number, remainingMs = 10_000): OpenRound => ({
	index,
	options: [option(1), option(2)],
	deadline: SERVER_NOW + remainingMs,
	serverNow: SERVER_NOW,
	remainingMs
});

const verdict = (index: number, correct: boolean, over: Partial<Verdict> = {}): Verdict => ({
	index,
	correct,
	answer: { ...option(1), canton: 'BE' },
	points: correct ? 7 : 0,
	score: correct ? 7 : 0,
	correctCount: correct ? 1 : 0,
	next: { index: index + 1, photoUrl: `/photo/${index + 1}` },
	finished: false,
	revealMs: correct ? 1_000 : 3_000,
	...over
});

type Script = (url: string, body: Record<string, unknown>) => Response | Promise<Response>;

const setup = (script: Script, total = 10) => {
	const states: LoopState[] = [];
	const calls: { url: string; body: Record<string, unknown> }[] = [];
	const fetcher = (async (url: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body));
		calls.push({ url, body });
		return script(url, body);
	}) as unknown as typeof fetch;
	const loop = createRoundLoop(game(total), { fetcher, onChange: (s) => states.push(s) });
	const last = () => states[states.length - 1];
	return { loop, states, calls, last };
};

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('round loop', () => {
	it('a right answer shows the verdict, then loads the next round after revealMs', async () => {
		const { loop, last, calls } = setup((url) =>
			url.endsWith('/start') ? reply(open(0)) : reply(verdict(0, true))
		);
		loop.photoLoaded();
		await flush();
		expect(last()).toMatchObject({ phase: 'playing', remainingMs: 10_000, index: 0 });

		loop.choose(1);
		await flush();
		expect(last()).toMatchObject({
			phase: 'revealing',
			chosenId: 1,
			score: 7,
			correctCount: 1,
			points: [7]
		});
		expect(last().verdict?.correct).toBe(true);

		await vi.advanceTimersByTimeAsync(999);
		expect(last().phase).toBe('revealing');
		await vi.advanceTimersByTimeAsync(1);
		expect(last()).toMatchObject({
			phase: 'loading',
			index: 1,
			photoUrl: '/photo/1',
			chosenId: null,
			verdict: null
		});
		expect(calls.map((c) => c.url)).toEqual([
			'/api/game/g1/round/0/start',
			'/api/game/g1/round/0/answer'
		]);
	});

	it('the clock sends a null answer when remainingMs runs out', async () => {
		const { loop, last, calls } = setup((url) =>
			url.endsWith('/start') ? reply(open(0, 4_000)) : reply(verdict(0, false))
		);
		loop.photoLoaded();
		await flush();
		await vi.advanceTimersByTimeAsync(3_999);
		expect(calls).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(calls[1]).toEqual({ url: '/api/game/g1/round/0/answer', body: { memberId: null } });
		expect(last().phase).toBe('revealing');
	});

	it('a second choose while pending is ignored', async () => {
		let release: (r: Response) => void = () => {};
		const { loop, calls, last } = setup((url) =>
			url.endsWith('/start')
				? reply(open(0))
				: new Promise<Response>((resolve) => (release = resolve))
		);
		loop.photoLoaded();
		await flush();
		loop.choose(1);
		loop.choose(2);
		await flush();
		expect(calls.filter((c) => c.url.endsWith('/answer'))).toHaveLength(1);
		expect(last()).toMatchObject({ phase: 'pending', chosenId: 1 });
		release(reply(verdict(0, true)));
		await flush();
		expect(last().phase).toBe('revealing');
	});

	it('ignores photoLoaded outside loading and a second one while opening', async () => {
		const { loop, calls } = setup(() => reply(open(0)));
		loop.photoLoaded();
		loop.photoLoaded();
		await flush();
		loop.photoLoaded();
		await flush();
		expect(calls).toHaveLength(1);
	});

	it('two photo failures retry the same URL after a backoff, the third asks for a replacement', async () => {
		const { loop, last, calls } = setup((_url, body) =>
			body.photoFailed
				? reply({ replaced: true, round: { index: 0, photoUrl: '/photo/0b' } })
				: reply(open(0))
		);
		loop.photoFailed();
		await vi.advanceTimersByTimeAsync(499);
		expect(last()).toMatchObject({ photoUrl: '/photo/0', photoStatus: 'retrying' });
		await vi.advanceTimersByTimeAsync(1);
		expect(last()).toMatchObject({ phase: 'loading', photoUrl: '/photo/0?retry=1' });

		loop.photoFailed();
		await vi.advanceTimersByTimeAsync(1_499);
		expect(last().photoUrl).toBe('/photo/0?retry=1');
		await vi.advanceTimersByTimeAsync(1);
		expect(last().photoUrl).toBe('/photo/0?retry=2');
		expect(calls).toHaveLength(0);

		loop.photoFailed();
		await flush();
		expect(calls[0].body).toEqual({
			photoFailed: true,
			photoUrl: '/photo/0',
			attempt: expect.any(String)
		});
		expect(last()).toMatchObject({ phase: 'loading', photoUrl: '/photo/0b' });
	});

	it('a photo the server was too busy for is loaded again, and a replacement can still be asked', async () => {
		const { loop, last, calls } = setup((_url, body) =>
			body.photoFailed
				? reply({ replaced: true, round: { index: 0, photoUrl: '/photo/0' } })
				: reply(open(0))
		);
		loop.photoFailed();
		await vi.advanceTimersByTimeAsync(500);
		loop.photoFailed();
		await vi.advanceTimersByTimeAsync(1_500);
		loop.photoFailed();
		await flush();
		expect(calls).toHaveLength(1);
		expect(last()).toMatchObject({ phase: 'loading', photoStatus: 'retrying' });

		await vi.advanceTimersByTimeAsync(2_000);
		expect(last()).toMatchObject({ phase: 'loading', photoUrl: '/photo/0?retry=3' });
		loop.photoFailed();
		await vi.advanceTimersByTimeAsync(500);
		expect(last().photoUrl).toBe('/photo/0?retry=4');
		loop.photoFailed();
		await vi.advanceTimersByTimeAsync(1_500);
		loop.photoFailed();
		await flush();
		expect(calls).toHaveLength(2);
		expect(calls[1].body).toEqual({
			photoFailed: true,
			photoUrl: '/photo/0',
			attempt: expect.any(String)
		});
	});

	it('a photo that loads on retry opens the round with photoStatus back to ok', async () => {
		const { loop, last, states } = setup(() => reply(open(0)));
		expect(states).toHaveLength(0);
		loop.photoFailed();
		expect(last()).toMatchObject({ phase: 'loading', photoStatus: 'retrying' });
		await vi.advanceTimersByTimeAsync(500);
		expect(last()).toMatchObject({ photoUrl: '/photo/0?retry=1', photoStatus: 'retrying' });
		loop.photoLoaded();
		await flush();
		expect(last()).toMatchObject({ phase: 'playing', photoStatus: 'ok' });
	});

	it('a replacement shows replacing until its photo opens, the next round starts ok', async () => {
		let release: (r: Response) => void = () => {};
		const { loop, last } = setup((url, body) => {
			if (body.photoFailed) return new Promise<Response>((resolve) => (release = resolve));
			return url.endsWith('/start') ? reply(open(0)) : reply(verdict(0, true));
		});
		loop.photoFailed();
		await vi.advanceTimersByTimeAsync(500);
		loop.photoFailed();
		await vi.advanceTimersByTimeAsync(1_500);
		loop.photoFailed();
		expect(last()).toMatchObject({ phase: 'loading', photoStatus: 'replacing' });
		release(reply({ replaced: true, round: { index: 0, photoUrl: '/photo/0b' } }));
		await flush();
		expect(last()).toMatchObject({ photoUrl: '/photo/0b', photoStatus: 'replacing' });
		loop.photoLoaded();
		await flush();
		expect(last()).toMatchObject({ phase: 'playing', photoStatus: 'ok' });
		loop.choose(1);
		await flush();
		await vi.advanceTimersByTimeAsync(1_000);
		expect(last()).toMatchObject({ phase: 'loading', index: 1, photoStatus: 'ok' });
	});

	it('a photo failure while a retry waits is ignored', async () => {
		const { loop, last, calls } = setup(() => reply(open(0)));
		loop.photoFailed();
		loop.photoFailed();
		loop.photoFailed();
		await vi.advanceTimersByTimeAsync(500);
		expect(last().photoUrl).toBe('/photo/0?retry=1');
		await vi.advanceTimersByTimeAsync(5_000);
		expect(last().photoUrl).toBe('/photo/0?retry=1');
		expect(calls).toHaveLength(0);
	});

	it('a refused replacement ends in failed with game.photoTrouble', async () => {
		const { loop, last } = setup(() => reply({ message: 'game.photoTrouble' }, 409));
		loop.photoFailed();
		await vi.advanceTimersByTimeAsync(500);
		loop.photoFailed();
		await vi.advanceTimersByTimeAsync(1_500);
		loop.photoFailed();
		await flush();
		expect(last()).toMatchObject({ phase: 'failed', error: 'game.photoTrouble' });
	});

	it('any other error ends in failed with its key, game.error without a response', async () => {
		const { loop, last } = setup(() => {
			throw new TypeError('network');
		});
		loop.photoLoaded();
		await flush();
		expect(last()).toMatchObject({ phase: 'failed', error: 'game.error' });
	});

	it('missed faces collect the wrong and unanswered rounds with their photo', async () => {
		let round = 0;
		const { loop, last } = setup((url) => {
			if (url.endsWith('/start')) return reply(open(round, 2_000));
			const current = round++;
			return reply(verdict(current, current === 1));
		});
		loop.photoLoaded();
		await flush();
		await vi.advanceTimersByTimeAsync(2_000);
		await vi.advanceTimersByTimeAsync(3_000);
		loop.photoLoaded();
		await flush();
		loop.choose(1);
		await flush();
		await vi.advanceTimersByTimeAsync(1_000);
		loop.photoLoaded();
		await flush();
		loop.choose(2);
		await flush();
		expect(last().missed).toHaveLength(2);
		expect(last().missed.map((m) => m.photoUrl)).toEqual(['/photo/0', '/photo/2']);
		expect(last().points).toEqual([0, 7, 0]);
	});

	it('the tenth verdict ends in finished with the score', async () => {
		const { loop, last } = setup(
			(url) =>
				url.endsWith('/start')
					? reply(open(0))
					: reply(verdict(0, true, { next: null, finished: true, score: 93, correctCount: 10 })),
			1
		);
		loop.photoLoaded();
		await flush();
		loop.choose(1);
		await flush();
		await vi.advanceTimersByTimeAsync(1_000);
		expect(last()).toMatchObject({ phase: 'finished', score: 93, correctCount: 10 });
	});

	it('nothing changes after destroy', async () => {
		const { loop, states, calls } = setup((url) =>
			url.endsWith('/start') ? reply(open(0, 3_000)) : reply(verdict(0, true))
		);
		loop.photoLoaded();
		await flush();
		const seen = states.length;
		loop.destroy();
		await vi.advanceTimersByTimeAsync(10_000);
		loop.choose(1);
		loop.photoFailed();
		await flush();
		expect(states).toHaveLength(seen);
		expect(calls).toHaveLength(1);
	});

	it('does not report a response that arrives after destroy', async () => {
		let release: (r: Response) => void = () => {};
		const { loop, states } = setup(() => new Promise<Response>((resolve) => (release = resolve)));
		loop.photoLoaded();
		await flush();
		const seen = states.length;
		loop.destroy();
		release(reply(open(0)));
		await flush();
		expect(states).toHaveLength(seen);
	});
});
