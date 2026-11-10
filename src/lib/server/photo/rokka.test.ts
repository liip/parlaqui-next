import { describe, expect, it, vi } from 'vitest';
import { rokkaHashUrl, uploadToRokka } from './rokka';

const HASH = 'e'.repeat(40);

function answering(response: Response) {
	return vi.fn(async () => response) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe('uploadToRokka', () => {
	it('posts the image to the parlaqui organisation and returns the hash', async () => {
		const fetchFn = answering(Response.json({ total: 1, items: [{ hash: HASH }] }));

		expect(await uploadToRokka(Buffer.from('jpeg'), 'key', fetchFn)).toBe(HASH);

		const [url, init] = fetchFn.mock.calls[0];
		expect(url).toBe('https://api.rokka.io/sourceimages/parlaqui');
		expect(init.method).toBe('POST');
		expect(init.headers).toEqual({ 'Api-Key': 'key' });
		const file = (init.body as FormData).get('filedata') as Blob;
		expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('jpeg');
	});

	it('throws on an error status', async () => {
		const fetchFn = answering(new Response('', { status: 403 }));
		await expect(uploadToRokka(Buffer.from('jpeg'), 'key', fetchFn)).rejects.toThrow('403');
	});

	it('throws when the answer has no valid hash', async () => {
		const fetchFn = answering(Response.json({ items: [{ hash: 'nope' }] }));
		await expect(uploadToRokka(Buffer.from('jpeg'), 'key', fetchFn)).rejects.toThrow('no hash');
	});
});

describe('rokkaHashUrl', () => {
	it('renders the uploaded image through the par stack', () => {
		expect(rokkaHashUrl(HASH)).toBe(`https://parlaqui.rokka.io/par/${HASH}.jpg`);
	});
});
