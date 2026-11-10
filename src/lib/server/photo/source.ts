import sharp from 'sharp';
import { photoSourceUrl } from '$lib/server/roster/photos';
import { rokkaHashUrl, rokkaPhotoUrl } from './rokka';

export { rokkaPhotoUrl };

const ROKKA_TIMEOUT_MS = 3_000;
const PARLAMENT_TIMEOUT_MS = 10_000;
const MAX_SOURCES = 400;
const MAX_BYTES = 5_000_000;
const MAX_PIXELS = 25_000_000;

const sources = new Map<string, { hash: string | null; image: Buffer }>();
const loading = new Map<string, Promise<Buffer>>();

// stats() decodes every pixel, so a truncated file fails here and not later in a round
export async function isDecodable(image: Buffer): Promise<boolean> {
	try {
		await sharp(image, { limitInputPixels: MAX_PIXELS }).stats();
		return true;
	} catch {
		return false;
	}
}

async function readLimited(response: Response): Promise<Buffer> {
	if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) {
		throw new Error(`larger than ${MAX_BYTES} bytes`);
	}
	if (!response.body) return Buffer.alloc(0);
	const chunks: Uint8Array[] = [];
	let size = 0;
	for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
		size += chunk.length;
		if (size > MAX_BYTES) throw new Error(`larger than ${MAX_BYTES} bytes`);
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

async function fetchImage(
	url: string,
	timeoutMs: number,
	fetchFn: typeof fetch
): Promise<Buffer | null> {
	try {
		const response = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
		if (response.status !== 200) return null;
		if (!(response.headers.get('content-type') ?? '').startsWith('image/')) return null;
		const image = await readLimited(response);
		return (await isDecodable(image)) ? image : null;
	} catch {
		return null;
	}
}

export function downloadParlamentPhoto(
	code: string,
	fetchFn: typeof fetch = fetch
): Promise<Buffer | null> {
	return fetchImage(photoSourceUrl(code), PARLAMENT_TIMEOUT_MS, fetchFn);
}

// null: parlament.ch says there is no portrait; a throw: it could not be told, so nothing may change
export async function fetchPortrait(
	code: string,
	fetchFn: typeof fetch = fetch
): Promise<Buffer | null> {
	const response = await fetchFn(photoSourceUrl(code), {
		signal: AbortSignal.timeout(PARLAMENT_TIMEOUT_MS)
	});
	if (response.status === 404) return null;
	if (response.status !== 200) throw new Error(`parlament.ch answered ${response.status}`);
	if (!(response.headers.get('content-type') ?? '').startsWith('image/')) return null;
	const image = await readLimited(response);
	if (!(await isDecodable(image)))
		throw new Error('parlament.ch sent an image that does not decode');
	return image;
}

async function download(code: string, hash: string | null, fetchFn: typeof fetch) {
	const rokkaUrl = hash ? rokkaHashUrl(hash) : rokkaPhotoUrl(code);
	const image =
		(await fetchImage(rokkaUrl, ROKKA_TIMEOUT_MS, fetchFn)) ??
		(await downloadParlamentPhoto(code, fetchFn));
	if (!image) throw new Error(`no photo source answered for ${code}`);

	sources.delete(code);
	sources.set(code, { hash, image });
	if (sources.size > MAX_SOURCES) sources.delete(sources.keys().next().value as string);
	return image;
}

// hash: the portrait the roster import uploaded to rokka; without one, rokka's remote copy is used
export async function loadSource(
	code: string,
	hash: string | null = null,
	fetchFn: typeof fetch = fetch
): Promise<Buffer> {
	const cached = sources.get(code);
	if (cached && cached.hash === hash) return cached.image;

	// a class asking for one face at once downloads it once
	const key = `${code}:${hash}`;
	const inFlight = loading.get(key);
	if (inFlight) return inFlight;
	const load = download(code, hash, fetchFn).finally(() => loading.delete(key));
	loading.set(key, load);
	return load;
}

export function forgetSource(code: string): void {
	sources.delete(code);
}
