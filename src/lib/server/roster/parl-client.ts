import { LANGUAGES, type Language } from '$lib/i18n';
import type { RawSnapshot } from './types';

const PERSONS_URL = 'https://ws.parl.ch/api/v1/persons';
const MEMBERS_QUERY =
	'and(eq(active,true),eq(type.key,"1731013"),in(council.key,"1311000","1311001"))';
const MEMBER_FIELDS =
	'id,legacyId,active,firstName,lastName,gender,type,council,canton,party,activeElection';
const PAGE_SIZE = 100;
const TIMEOUT_MS = 20_000;
const MAX_PAGES = 50;

type PersonsPage = {
	content?: unknown[];
	page?: { hasNext?: boolean; totalElements?: number | null };
};

function pageUrl(lang: Language, page: number): string {
	const url = new URL(PERSONS_URL);
	url.searchParams.set('lang', lang);
	url.searchParams.set('q', MEMBERS_QUERY);
	url.searchParams.set('include', MEMBER_FIELDS);
	url.searchParams.set('sort', 'id');
	url.searchParams.set('size', String(PAGE_SIZE));
	url.searchParams.set('page', String(page));
	url.searchParams.set('withCounts', 'true');
	return url.toString();
}

async function fetchPage(apiKey: string, url: string, fetchFn: typeof fetch): Promise<PersonsPage> {
	const response = await fetchFn(url, {
		headers: { 'X-API-KEY': apiKey, Accept: 'application/json' },
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	if (!response.ok) throw new Error(`ws.parl.ch answered ${response.status} for ${url}`);
	return (await response.json()) as PersonsPage;
}

async function fetchLanguage(
	apiKey: string,
	lang: Language,
	fetchFn: typeof fetch
): Promise<unknown[]> {
	const persons: unknown[] = [];
	let total: number | null | undefined;
	for (let page = 0; ; page++) {
		if (page >= MAX_PAGES) throw new Error(`ws.parl.ch ${lang}: more than ${MAX_PAGES} pages`);
		const result = await fetchPage(apiKey, pageUrl(lang, page), fetchFn);
		const content = result.content ?? [];
		persons.push(...content);
		total = result.page?.totalElements;
		if (!result.page?.hasNext) break;
		if (content.length === 0)
			throw new Error(`ws.parl.ch ${lang}: empty page ${page} with hasNext`);
	}
	if (typeof total !== 'number') throw new Error(`ws.parl.ch announced no total for ${lang}`);
	if (persons.length !== total) {
		throw new Error(`ws.parl.ch ${lang}: received ${persons.length} persons, announced ${total}`);
	}
	return persons;
}

export async function fetchSnapshot(
	apiKey: string,
	fetchFn: typeof fetch = fetch
): Promise<RawSnapshot> {
	const lists = await Promise.all(LANGUAGES.map((lang) => fetchLanguage(apiKey, lang, fetchFn)));
	return Object.fromEntries(LANGUAGES.map((lang, i) => [lang, lists[i]])) as RawSnapshot;
}
