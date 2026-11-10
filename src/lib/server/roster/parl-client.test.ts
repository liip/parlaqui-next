import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '$lib/i18n';
import { fetchSnapshot } from './parl-client';

const API_KEY = 'test-key-not-real';

type Page = { content: { id: number }[]; page: Record<string, unknown> };
type Request = { url: URL; headers: Record<string, string> };

function fixture(lang: string, page: number): Page {
	const path = new URL(
		`../../../../test/fixtures/parl/persons-${lang}-page${page}.json`,
		import.meta.url
	);
	return JSON.parse(readFileSync(path, 'utf8')) as Page;
}

function fakeApi(
	override: (request: Request, page: number) => Response | Error | undefined = () => undefined
) {
	const requests: Request[] = [];
	const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		const request = { url, headers: (init?.headers ?? {}) as Record<string, string> };
		requests.push(request);
		const page = Number(url.searchParams.get('page'));
		const overridden = override(request, page);
		if (overridden instanceof Error) throw overridden;
		if (overridden) return overridden;
		const body = fixture(url.searchParams.get('lang') ?? '', page);
		return new Response(JSON.stringify(body), { status: 200 });
	}) as typeof fetch;
	return { fetchFn, requests };
}

describe('fetchSnapshot', () => {
	it('fetches every page in every language', async () => {
		const { fetchFn, requests } = fakeApi();
		const snapshot = await fetchSnapshot(API_KEY, fetchFn);
		const expectedIds = [...fixture('de', 0).content, ...fixture('de', 1).content].map((p) => p.id);
		expect(expectedIds).toHaveLength(6);
		for (const lang of LANGUAGES) {
			expect((snapshot[lang] as { id: number }[]).map((p) => p.id)).toEqual(expectedIds);
		}
		expect(requests).toHaveLength(LANGUAGES.length * 2);
	});

	it('sends the key header and the documented member query on every request', async () => {
		const { fetchFn, requests } = fakeApi();
		await fetchSnapshot(API_KEY, fetchFn);
		for (const { url, headers } of requests) {
			expect(headers['X-API-KEY']).toBe(API_KEY);
			expect(url.origin + url.pathname).toBe('https://ws.parl.ch/api/v1/persons');
			expect(url.searchParams.get('q')).toBe(
				'and(eq(active,true),eq(type.key,"1731013"),in(council.key,"1311000","1311001"))'
			);
			expect(url.searchParams.get('size')).toBe('100');
			expect(url.searchParams.get('sort')).toBe('id');
			expect(url.searchParams.get('withCounts')).toBe('true');
			expect(url.toString()).not.toContain(API_KEY);
		}
	});

	it('throws when a page answers 500', async () => {
		const { fetchFn } = fakeApi((_, page) =>
			page === 1 ? new Response('', { status: 500 }) : undefined
		);
		await expect(fetchSnapshot(API_KEY, fetchFn)).rejects.toThrow(/500/);
	});

	it('rejects when page 3 of one language fails after pages 1 and 2 succeeded', async () => {
		const persons = [...fixture('fr', 0).content, ...fixture('fr', 1).content];
		const threePages = (page: number): Page => ({
			content: persons.slice(page * 2, page * 2 + 2),
			page: { hasNext: page < 2, totalElements: 6 }
		});
		const log: string[] = [];
		const { fetchFn, requests } = fakeApi((request, page) => {
			const lang = request.url.searchParams.get('lang');
			if (lang !== 'fr') return undefined;
			log.push(`${lang}:${page}`);
			if (page === 2) return new Response('', { status: 500 });
			return new Response(JSON.stringify(threePages(page)), { status: 200 });
		});
		await expect(fetchSnapshot(API_KEY, fetchFn)).rejects.toThrow(/500/);
		expect(log).toEqual(['fr:0', 'fr:1', 'fr:2']);
		expect(requests.some((r) => r.url.searchParams.get('page') === '3')).toBe(false);
	});

	it.each([
		['TimeoutError', 'The operation timed out'],
		['AbortError', 'This operation was aborted']
	])('rejects when a later page is cut off by a %s', async (name, message) => {
		const { fetchFn, requests } = fakeApi((request, page) =>
			request.url.searchParams.get('lang') === 'it' && page === 1
				? new DOMException(message, name)
				: undefined
		);
		await expect(fetchSnapshot(API_KEY, fetchFn)).rejects.toThrow();
		const itPages = requests
			.filter((r) => r.url.searchParams.get('lang') === 'it')
			.map((r) => r.url.searchParams.get('page'));
		expect(itPages).toEqual(['0', '1']);
	});

	it('throws when fewer persons arrive than the total announces', async () => {
		const { fetchFn } = fakeApi((request, page) => {
			if (page !== 1 || request.url.searchParams.get('lang') !== 'fr') return undefined;
			const body = fixture('fr', 1);
			body.content = body.content.slice(1);
			return new Response(JSON.stringify(body), { status: 200 });
		});
		await expect(fetchSnapshot(API_KEY, fetchFn)).rejects.toThrow(/fr/);
	});

	it('throws when a page is empty while hasNext is true', async () => {
		const { fetchFn, requests } = fakeApi((request, page) =>
			request.url.searchParams.get('lang') === 'de' && page === 1
				? new Response(JSON.stringify({ content: [], page: { hasNext: true, totalElements: 6 } }), {
						status: 200
					})
				: undefined
		);
		await expect(fetchSnapshot(API_KEY, fetchFn)).rejects.toThrow(/empty page/);
		const dePages = requests.filter((r) => r.url.searchParams.get('lang') === 'de');
		expect(dePages).toHaveLength(2);
	});

	it('stops after 50 pages in one language', async () => {
		const { fetchFn, requests } = fakeApi((request) =>
			request.url.searchParams.get('lang') === 'de'
				? new Response(
						JSON.stringify({ content: [{ id: 1 }], page: { hasNext: true, totalElements: 999 } }),
						{ status: 200 }
					)
				: undefined
		);
		await expect(fetchSnapshot(API_KEY, fetchFn)).rejects.toThrow(/more than 50 pages/);
		const dePages = requests.filter((r) => r.url.searchParams.get('lang') === 'de');
		expect(dePages).toHaveLength(50);
	});

	it('throws when the response has no total count', async () => {
		const { fetchFn } = fakeApi((_, page) => {
			const body = fixture('de', page);
			body.page.totalElements = null;
			return new Response(JSON.stringify(body), { status: 200 });
		});
		await expect(fetchSnapshot(API_KEY, fetchFn)).rejects.toThrow();
	});

	it('never puts the key in an error message', async () => {
		const { fetchFn } = fakeApi(() => new Response('', { status: 401 }));
		const error = await fetchSnapshot(API_KEY, fetchFn).catch((e: Error) => e);
		expect(String((error as Error).message)).not.toContain(API_KEY);
	});
});
