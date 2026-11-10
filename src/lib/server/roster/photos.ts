const TIMEOUT_MS = 20_000;

export function photoSourceUrl(code: string): string {
	return `https://www.parlament.ch/SiteCollectionImages/profil/portrait-260/${code}.jpg`;
}

async function request(url: string, method: 'HEAD' | 'GET', fetchFn: typeof fetch) {
	return fetchFn(url, { method, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

// false only for a definite "no photo"; anything uncertain throws so stored codes survive an outage
export async function checkPhoto(code: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
	const url = photoSourceUrl(code);
	let response = await request(url, 'HEAD', fetchFn);
	if (response.status === 405) response = await request(url, 'GET', fetchFn);
	if (response.status === 404) return false;
	if (!response.ok) throw new Error(`photo check answered ${response.status} for ${url}`);
	return (response.headers.get('content-type') ?? '').startsWith('image/');
}
