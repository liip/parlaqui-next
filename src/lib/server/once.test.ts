import { describe, expect, it } from 'vitest';
import { onceSucceeded } from './once';

// a piece of work whose outcome this test decides, one attempt at a time
function controllable() {
	let attempts = 0;
	let settle: { ok: (value: string) => void; fail: (cause: Error) => void } | null = null;

	const work = () =>
		new Promise<string>((resolve, reject) => {
			attempts++;
			settle = { ok: resolve, fail: reject };
		});

	return {
		work,
		get attempts() {
			return attempts;
		},
		ok: (value: string) => settle?.ok(value),
		fail: (message: string) => settle?.fail(new Error(message))
	};
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('onceSucceeded', () => {
	it('keeps a success and never runs the work again', async () => {
		const job = controllable();
		const once = onceSucceeded(job.work);

		const first = once();
		await settled();
		job.ok('migrated');

		expect(await first).toBe('migrated');
		expect(await once()).toBe('migrated');
		expect(await once()).toBe('migrated');
		expect(job.attempts).toBe(1);
	});

	it('hands one running attempt to every caller waiting on it', async () => {
		const job = controllable();
		const once = onceSucceeded(job.work);

		const waiting = [once(), once(), once()];
		await settled();
		job.ok('migrated');

		expect(await Promise.all(waiting)).toEqual(['migrated', 'migrated', 'migrated']);
		expect(job.attempts).toBe(1);
	});

	// the one this repository was built for: a database that is not up yet must not brick the process
	it('lets the next caller try again after a failure, and keeps what that one returns', async () => {
		const job = controllable();
		const once = onceSucceeded(job.work);

		const failing = once();
		await settled();
		job.fail('connect ECONNREFUSED');
		await expect(failing).rejects.toThrow('connect ECONNREFUSED');

		const retry = once();
		await settled();
		job.ok('migrated');

		expect(await retry).toBe('migrated');
		expect(await once()).toBe('migrated');
		expect(job.attempts).toBe(2);
	});

	// a failure must not turn every request in flight into a migration of its own
	it('shares one failing attempt among the callers already waiting on it', async () => {
		const job = controllable();
		const once = onceSucceeded(job.work);

		const waiting = [once(), once(), once(), once(), once()];
		await settled();
		expect(job.attempts).toBe(1);

		job.fail('connect ECONNREFUSED');
		const outcomes = await Promise.allSettled(waiting);

		expect(outcomes.map((one) => one.status)).toEqual(Array(5).fill('rejected'));
		expect(job.attempts).toBe(1);
	});

	it('reports a failure to every caller and not only to the first', async () => {
		const job = controllable();
		const once = onceSucceeded(job.work);

		const first = once();
		const second = once();
		await settled();
		job.fail('connect ECONNREFUSED');

		await expect(first).rejects.toThrow('connect ECONNREFUSED');
		await expect(second).rejects.toThrow('connect ECONNREFUSED');
	});
});
