import { describe, expect, it } from 'vitest';
import { RenderOverload, createRenderCache } from './render-cache';

const image = (text: string) => Buffer.from(text);

describe('createRenderCache', () => {
	it('renders a key once even when it is asked for many times at once', async () => {
		const cached = createRenderCache({ size: 10, concurrency: 2, maxWaiting: 50 });
		let renders = 0;
		const render = async () => {
			renders++;
			await new Promise((resolve) => setTimeout(resolve, 10));
			return image('a');
		};
		const results = await Promise.all(Array.from({ length: 20 }, () => cached('a', render)));
		expect(renders).toBe(1);
		expect(results.every((result) => result.equals(image('a')))).toBe(true);
		await cached('a', render);
		expect(renders).toBe(1);
	});

	it('never runs more renders at once than allowed', async () => {
		const cached = createRenderCache({ size: 10, concurrency: 2, maxWaiting: 50 });
		let running = 0;
		let peak = 0;
		const render = (key: string) => async () => {
			running++;
			peak = Math.max(peak, running);
			await new Promise((resolve) => setTimeout(resolve, 5));
			running--;
			return image(key);
		};
		await Promise.all(['a', 'b', 'c', 'd', 'e'].map((key) => cached(key, render(key))));
		expect(peak).toBe(2);
	});

	it('does not keep a failure, and forgets the oldest result beyond its size', async () => {
		const cached = createRenderCache({ size: 1, concurrency: 1, maxWaiting: 50 });
		await expect(cached('a', async () => Promise.reject(new Error('down')))).rejects.toThrow(
			'down'
		);
		expect((await cached('a', async () => image('a'))).toString()).toBe('a');
		await cached('b', async () => image('b'));
		let again = false;
		await cached('a', async () => {
			again = true;
			return image('a');
		});
		expect(again).toBe(true);
	});

	it('refuses a new key once the queue is full, but still shares one already under way', async () => {
		const cached = createRenderCache({ size: 10, concurrency: 1, maxWaiting: 2 });
		let open = () => {};
		const gate = new Promise<void>((resolve) => (open = resolve));
		const render = (key: string) => async () => {
			await gate;
			return image(key);
		};
		const accepted = ['a', 'b', 'c'].map((key) => cached(key, render(key)));

		await expect(cached('d', render('d'))).rejects.toBeInstanceOf(RenderOverload);
		const shared = cached('b', render('b'));
		open();
		expect((await Promise.all([...accepted, shared])).map(String)).toEqual(['a', 'b', 'c', 'b']);
		expect((await cached('d', render('d'))).toString()).toBe('d');
	});

	it('peeks at a result rendered or under way, never at one that failed or was not asked for', async () => {
		const cached = createRenderCache({ size: 10, concurrency: 3, maxWaiting: 10 });
		let open = () => {};
		const gate = new Promise<void>((resolve) => (open = resolve));
		const slow = cached('slow', async () => {
			await gate;
			return image('slow');
		});
		await cached('done', async () => image('done'));
		await expect(cached('failed', async () => Promise.reject(new Error('x')))).rejects.toThrow();

		expect((await cached.peek('done'))?.toString()).toBe('done');
		const underWay = cached.peek('slow');
		open();
		expect((await underWay)?.toString()).toBe('slow');
		await slow;
		expect(cached.peek('failed')).toBeUndefined();
		expect(cached.peek('never')).toBeUndefined();
	});
});
