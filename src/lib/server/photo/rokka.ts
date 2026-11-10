const API = 'https://api.rokka.io';
const ORGANIZATION = 'parlaqui';
const UPLOAD_TIMEOUT_MS = 20_000;
const HASH = /^[0-9a-f]{40}$/;

export function rokkaPhotoUrl(code: string): string {
	return `https://${ORGANIZATION}.rokka.io/par/-${code}.jpg-.jpg`;
}

export function rokkaHashUrl(hash: string): string {
	return `https://${ORGANIZATION}.rokka.io/par/${hash}.jpg`;
}

export async function uploadToRokka(
	image: Buffer,
	apiKey: string,
	fetchFn: typeof fetch = fetch
): Promise<string> {
	const form = new FormData();
	form.append(
		'filedata',
		new Blob([new Uint8Array(image)], { type: 'image/jpeg' }),
		'portrait.jpg'
	);
	const response = await fetchFn(`${API}/sourceimages/${ORGANIZATION}`, {
		method: 'POST',
		headers: { 'Api-Key': apiKey },
		body: form,
		signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
	});
	if (!response.ok) throw new Error(`rokka upload answered ${response.status}`);
	const hash = (await response.json())?.items?.[0]?.hash;
	if (typeof hash !== 'string' || !HASH.test(hash)) throw new Error('rokka upload gave no hash');
	return hash;
}
