import { describe, expect, it, vi } from 'vitest';
import { createDailyTask, repeat } from './daily';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createDailyTask', () => {
	it('runs once a day after a success', async () => {
		const run = vi.fn(async () => {});
		const task = createDailyTask(run, { retryMs: 1000, onError: () => {} });
		task('2026-11-30', 0);
		await settle();
		task('2026-11-30', 5000);
		await settle();
		task('2026-12-01', 6000);
		await settle();
		expect(run).toHaveBeenCalledTimes(2);
	});

	it('reports a failure and tries again only after the delay', async () => {
		const onError = vi.fn();
		const run = vi
			.fn()
			.mockRejectedValueOnce(new Error('lock timeout'))
			.mockResolvedValue(undefined);
		const task = createDailyTask(run, { retryMs: 1000, onError });
		task('2026-11-30', 0);
		await settle();
		expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'lock timeout' }));
		task('2026-11-30', 500);
		await settle();
		expect(run).toHaveBeenCalledTimes(1);
		task('2026-11-30', 1500);
		await settle();
		task('2026-11-30', 9000);
		await settle();
		expect(run).toHaveBeenCalledTimes(2);
	});

	it('never runs twice at once', async () => {
		let finish = () => {};
		const run = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
		const task = createDailyTask(run, { retryMs: 1000, onError: () => {} });
		task('2026-11-30', 0);
		task('2026-11-30', 1);
		expect(run).toHaveBeenCalledTimes(1);
		finish();
		await settle();
	});
});

describe('repeat', () => {
	it('runs at once, then at every interval', () => {
		vi.useFakeTimers({ toFake: ['setInterval'] });
		try {
			const tick = vi.fn();
			repeat(tick, 3_600_000);
			expect(tick).toHaveBeenCalledTimes(1);
			vi.advanceTimersByTime(3_600_000 * 2);
			expect(tick).toHaveBeenCalledTimes(3);
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not keep the process alive', () => {
		const timer = repeat(() => {}, 3_600_000);
		expect(timer.hasRef()).toBe(false);
		clearInterval(timer);
	});
});
