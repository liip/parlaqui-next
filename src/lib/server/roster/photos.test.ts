import { describe, expect, it } from 'vitest';
import { checkPhoto, photoSourceUrl } from './photos';

type Call = { url: string; method: string };

function fakeFetch(answer: (call: Call) => Response | Error): typeof fetch & { calls: Call[] } {
	const calls: Call[] = [];
	const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
		const call = { url: String(input), method: init?.method ?? 'GET' };
		calls.push(call);
		const result = answer(call);
		if (result instanceof Error) throw result;
		return result;
	};
	return Object.assign(fn, { calls }) as typeof fetch & { calls: Call[] };
}

const jpeg = () => new Response(null, { status: 200, headers: { 'content-type': 'image/jpeg' } });

describe('photoSourceUrl', () => {
	it('points at the 260 px portrait on parlament.ch', () => {
		expect(photoSourceUrl('2513')).toBe(
			'https://www.parlament.ch/SiteCollectionImages/profil/portrait-260/2513.jpg'
		);
	});
});

describe('checkPhoto', () => {
	it('is true for 200 with an image content type', async () => {
		const fetchFn = fakeFetch(jpeg);
		expect(await checkPhoto('2513', fetchFn)).toBe(true);
		expect(fetchFn.calls).toEqual([{ url: photoSourceUrl('2513'), method: 'HEAD' }]);
	});

	it('is false for 404', async () => {
		expect(
			await checkPhoto(
				'1',
				fakeFetch(() => new Response(null, { status: 404 }))
			)
		).toBe(false);
	});

	it('is false for 200 with a non-image content type', async () => {
		const html = () =>
			new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } });
		expect(await checkPhoto('1', fakeFetch(html))).toBe(false);
	});

	it('falls back to GET when HEAD answers 405', async () => {
		const fetchFn = fakeFetch(({ method }) =>
			method === 'HEAD' ? new Response(null, { status: 405 }) : jpeg()
		);
		expect(await checkPhoto('1', fetchFn)).toBe(true);
		expect(fetchFn.calls.map((call) => call.method)).toEqual(['HEAD', 'GET']);
	});

	it('throws on a network error', async () => {
		await expect(
			checkPhoto(
				'1',
				fakeFetch(() => new TypeError('fetch failed'))
			)
		).rejects.toThrow();
	});

	it('throws on a timeout', async () => {
		const timeout = new DOMException('The operation timed out', 'TimeoutError');
		await expect(
			checkPhoto(
				'1',
				fakeFetch(() => timeout)
			)
		).rejects.toThrow();
	});

	it('throws on a 5xx answer', async () => {
		await expect(
			checkPhoto(
				'1',
				fakeFetch(() => new Response(null, { status: 503 }))
			)
		).rejects.toThrow(/503/);
	});

	it('throws on an unexpected status such as 429, which is no proof of a missing photo', async () => {
		await expect(
			checkPhoto(
				'1',
				fakeFetch(() => new Response(null, { status: 429 }))
			)
		).rejects.toThrow(/429/);
	});
});
