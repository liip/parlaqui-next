import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
	downloadParlamentPhoto,
	fetchPortrait,
	forgetSource,
	loadSource,
	rokkaPhotoUrl
} from './source';
import { rokkaHashUrl } from './rokka';
import { photoSourceUrl } from '$lib/server/roster/photos';

const jpeg = (width: number) =>
	sharp({ create: { width, height: 12, channels: 3, background: '#888' } })
		.jpeg()
		.toBuffer();

let rokka: Buffer;
let parlament: Buffer;

beforeAll(async () => {
	[rokka, parlament] = await Promise.all([jpeg(10), jpeg(20)]);
});

const image = (body: string | Buffer = rokka, type = 'image/jpeg', status = 200) =>
	new Response(new Uint8Array(Buffer.from(body)), { status, headers: { 'content-type': type } });

function fakeFetch(answers: Record<string, () => Response | Promise<Response>>) {
	return vi.fn(async (url: string | URL | Request) => {
		const answer = answers[String(url)];
		if (!answer) throw new Error('unexpected url');
		return answer();
	}) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe('loadSource', () => {
	it('uses rokka when it answers', async () => {
		const fetchFn = fakeFetch({ [rokkaPhotoUrl('a1')]: () => image(rokka) });
		expect((await loadSource('a1', null, fetchFn)).equals(rokka)).toBe(true);
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('falls back to parlament.ch when rokka fails', async () => {
		const fetchFn = fakeFetch({
			[rokkaPhotoUrl('a2')]: () => image('', 'text/html', 404),
			[photoSourceUrl('a2')]: () => image(parlament)
		});
		expect((await loadSource('a2', null, fetchFn)).equals(parlament)).toBe(true);
	});

	it('throws when both fail', async () => {
		const fetchFn = fakeFetch({
			[rokkaPhotoUrl('a3')]: () => image('', 'image/jpeg', 500),
			[photoSourceUrl('a3')]: () => {
				throw new Error('down');
			}
		});
		await expect(loadSource('a3', null, fetchFn)).rejects.toThrow();
	});

	it('a non-image 200 counts as a failure', async () => {
		const fetchFn = fakeFetch({
			[rokkaPhotoUrl('a4')]: () => image('<html>', 'text/html'),
			[photoSourceUrl('a4')]: () => image(parlament)
		});
		expect((await loadSource('a4', null, fetchFn)).equals(parlament)).toBe(true);
	});

	it('caches a success, not a failure', async () => {
		const ok = fakeFetch({ [rokkaPhotoUrl('a5')]: () => image(rokka) });
		await loadSource('a5', null, ok);
		await loadSource('a5', null, ok);
		expect(ok).toHaveBeenCalledTimes(1);

		const down = fakeFetch({
			[rokkaPhotoUrl('a6')]: () => image('', 'image/jpeg', 500),
			[photoSourceUrl('a6')]: () => image('', 'image/jpeg', 500)
		});
		await expect(loadSource('a6', null, down)).rejects.toThrow();
		await expect(loadSource('a6', null, down)).rejects.toThrow();
		expect(down).toHaveBeenCalledTimes(4);
	});

	it('an image that cannot be decoded counts as a failure and is not cached', async () => {
		const broken = fakeFetch({
			[rokkaPhotoUrl('a7')]: () => image('not a jpeg'),
			[photoSourceUrl('a7')]: () => image('still not a jpeg')
		});
		await expect(loadSource('a7', null, broken)).rejects.toThrow();

		const fixed = fakeFetch({
			[rokkaPhotoUrl('a7')]: () => image('not a jpeg'),
			[photoSourceUrl('a7')]: () => image(parlament)
		});
		expect((await loadSource('a7', null, fixed)).equals(parlament)).toBe(true);
	});

	it('forgetSource makes the next load fetch again', async () => {
		const fetchFn = fakeFetch({ [rokkaPhotoUrl('a8')]: () => image(rokka) });
		await loadSource('a8', null, fetchFn);
		forgetSource('a8');
		await loadSource('a8', null, fetchFn);
		expect(fetchFn).toHaveBeenCalledTimes(2);
	});

	it('gives rokka 3 s and parlament.ch 10 s', async () => {
		const timeout = vi.spyOn(AbortSignal, 'timeout');
		const fetchFn = fakeFetch({
			[rokkaPhotoUrl('a9')]: () => image('', 'image/jpeg', 504),
			[photoSourceUrl('a9')]: () => image(parlament)
		});

		await loadSource('a9', null, fetchFn);

		expect(timeout.mock.calls).toEqual([[3_000], [10_000]]);
		timeout.mockRestore();
	});

	it('with a hash, uses the uploaded portrait and falls back to parlament.ch, never the remote copy', async () => {
		const hash = 'b'.repeat(40);
		const ok = fakeFetch({ [rokkaHashUrl(hash)]: () => image(rokka) });
		expect((await loadSource('b1', hash, ok)).equals(rokka)).toBe(true);

		const down = fakeFetch({
			[rokkaHashUrl(hash)]: () => image('', 'image/jpeg', 500),
			[photoSourceUrl('b2')]: () => image(parlament)
		});
		expect((await loadSource('b2', hash, down)).equals(parlament)).toBe(true);
		expect(down).toHaveBeenCalledTimes(2);
	});

	it('a new hash replaces the cached source', async () => {
		const [first, second] = ['c'.repeat(40), 'd'.repeat(40)];
		const fetchFn = fakeFetch({
			[rokkaHashUrl(first)]: () => image(rokka),
			[rokkaHashUrl(second)]: () => image(parlament)
		});
		await loadSource('b3', first, fetchFn);
		expect((await loadSource('b3', second, fetchFn)).equals(parlament)).toBe(true);
		expect((await loadSource('b3', second, fetchFn)).equals(parlament)).toBe(true);
		expect(fetchFn).toHaveBeenCalledTimes(2);
	});

	it('downloadParlamentPhoto gives null for a non-image answer', async () => {
		const fetchFn = fakeFetch({ [photoSourceUrl('b4')]: () => image('<html>', 'text/html') });
		expect(await downloadParlamentPhoto('b4', fetchFn)).toBeNull();
	});

	it('a truncated JPEG counts as a failure', async () => {
		const whole = await sharp({
			create: { width: 200, height: 200, channels: 3, background: '#468' }
		})
			.jpeg()
			.toBuffer();
		const fetchFn = fakeFetch({
			[rokkaPhotoUrl('b5')]: () => image(whole.subarray(0, Math.floor(whole.length * 0.6))),
			[photoSourceUrl('b5')]: () => image(parlament)
		});
		expect((await loadSource('b5', null, fetchFn)).equals(parlament)).toBe(true);
	});

	it('downloads a source once when ten rounds ask for it at once', async () => {
		const fetchFn = fakeFetch({ [rokkaPhotoUrl('b7')]: () => image(rokka) });

		const images = await Promise.all(
			Array.from({ length: 10 }, () => loadSource('b7', null, fetchFn))
		);

		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(images.every((one) => one.equals(rokka))).toBe(true);
	});

	it('shares a failed download with the loads waiting for it, then tries afresh', async () => {
		const fetchFn = fakeFetch({
			[rokkaPhotoUrl('b8')]: () => image('', 'image/jpeg', 500),
			[photoSourceUrl('b8')]: () => image('', 'image/jpeg', 500)
		});

		const loads = Array.from({ length: 5 }, () => loadSource('b8', null, fetchFn));
		for (const load of loads) await expect(load).rejects.toThrow();
		expect(fetchFn).toHaveBeenCalledTimes(2);
		await expect(loadSource('b8', null, fetchFn)).rejects.toThrow();
		expect(fetchFn).toHaveBeenCalledTimes(4);
	});

	it('refuses a body announced larger than 5 MB', async () => {
		const huge = () =>
			new Response(new Uint8Array(rokka), {
				headers: { 'content-type': 'image/jpeg', 'content-length': '6000000' }
			});
		const fetchFn = fakeFetch({
			[rokkaPhotoUrl('b6')]: huge,
			[photoSourceUrl('b6')]: () => image(parlament)
		});
		expect((await loadSource('b6', null, fetchFn)).equals(parlament)).toBe(true);
	});
});

describe('fetchPortrait', () => {
	it('gives the image, null for a 404 or a non-image, and throws on anything uncertain', async () => {
		const fetchFn = fakeFetch({
			[photoSourceUrl('c1')]: () => image(parlament),
			[photoSourceUrl('c2')]: () => image('', 'text/html', 404),
			[photoSourceUrl('c3')]: () => image('<html>', 'text/html'),
			[photoSourceUrl('c4')]: () => image('', 'image/jpeg', 503),
			[photoSourceUrl('c5')]: () => image('not a jpeg')
		});
		expect((await fetchPortrait('c1', fetchFn))?.equals(parlament)).toBe(true);
		expect(await fetchPortrait('c2', fetchFn)).toBeNull();
		expect(await fetchPortrait('c3', fetchFn)).toBeNull();
		await expect(fetchPortrait('c4', fetchFn)).rejects.toThrow('503');
		await expect(fetchPortrait('c5', fetchFn)).rejects.toThrow('does not decode');
	});
});
