// Probes the Swiss Parliament Open Data Web Service (https://ws.parl.ch) for the roster import.
// Usage: npx tsx scripts/parl-probe.ts [--check-photos] [--write-fixtures]
// Reads PARL_API_KEY from the environment, or from .env when it is not set.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://ws.parl.ch';
const LANGS = ['de', 'fr', 'it', 'rm'] as const;
const PAGE_SIZE = 100;
const PHOTO_CONCURRENCY = 8;

const COUNCIL_KEYS: Record<string, string> = { '1311000': 'Nationalrat', '1311001': 'Ständerat' };
const ASSEMBLY_MEMBER_TYPE_KEY = '1731013';
const MEMBERS_QUERY =
	'and(eq(active,true),eq(type.key,"1731013"),in(council.key,"1311000","1311001"))';
const MEMBER_FIELDS =
	'id,legacyId,active,firstName,lastName,gender,type,council,canton,party,activeElection';

const FIXTURE_DIR = 'test/fixtures/parl';
const FIXTURE_MEMBER_IDS = [491, 3891, 4265, 10817, 15601, 18110];
const FIXTURE_FEDERAL_COUNCILLOR_ID = 4062;
const FIXTURE_PAGE_SIZE = 3;

type Keyed = { key: string; abbreviation?: string | null; name?: string | null } | null;
type Person = {
	id: number;
	legacyId: number | null;
	firstName: string;
	lastName: string;
	gender: Keyed;
	type: Keyed;
	council: Keyed;
	canton: Keyed;
	party: { id: number; code: string; shortName: string | null; name: string | null } | null;
	activeElection: { swornInDate: string; leavingDate: string } | null;
};
type Page<T> = {
	content: T[];
	page: {
		size: number;
		number: number;
		hasNext: boolean;
		totalElements: number | null;
		totalPages: number | null;
	};
};

if (!process.env.PARL_API_KEY && existsSync('.env')) process.loadEnvFile('.env');
const apiKey = process.env.PARL_API_KEY;
if (!apiKey) {
	console.error('PARL_API_KEY is not set (request a key at https://ws.parl.ch/registration)');
	process.exit(1);
}

const args = new Set(process.argv.slice(2));

function apiUrl(path: string, params: Record<string, string | number>): string {
	const url = new URL(path, BASE);
	for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
	return url.toString();
}

async function getJson<T>(path: string, params: Record<string, string | number>): Promise<T> {
	const url = apiUrl(path, params);
	const response = await fetch(url, {
		headers: { 'X-API-KEY': apiKey!, Accept: 'application/json' }
	});
	if (!response.ok) throw new Error(`${response.status} for ${url}`);
	return (await response.json()) as T;
}

async function getAllPages(lang: string): Promise<Page<Person>[]> {
	const pages: Page<Person>[] = [];
	for (let page = 0; ; page++) {
		const result = await getJson<Page<Person>>('/api/v1/persons', {
			lang,
			q: MEMBERS_QUERY,
			include: MEMBER_FIELDS,
			sort: 'id',
			size: PAGE_SIZE,
			page,
			withCounts: 'true'
		});
		pages.push(result);
		if (!result.page.hasNext) return pages;
	}
}

export function photoUrl(legacyId: number): string {
	return `https://www.parlament.ch/SiteCollectionImages/profil/portrait-260/${legacyId}.jpg`;
}

export function rokkaUrl(legacyId: number): string {
	return `https://parlaqui.rokka.io/par/-${legacyId}.jpg-.jpg`;
}

async function mapLimited<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	const workers = Array.from({ length: limit }, async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = await fn(items[index]);
		}
	});
	await Promise.all(workers);
	return results;
}

type PhotoCheck = { url: string; status: number; type: string; bytes: number; sha1: string };

async function checkPhoto(url: string): Promise<PhotoCheck> {
	try {
		const response = await fetch(url);
		const body = Buffer.from(await response.arrayBuffer());
		return {
			url,
			status: response.status,
			type: response.headers.get('content-type') ?? '',
			bytes: body.length,
			sha1: createHash('sha1').update(body).digest('hex')
		};
	} catch (error) {
		return { url, status: 0, type: String(error), bytes: 0, sha1: '' };
	}
}

function label(person: Person): string {
	return `${person.id} ${person.firstName.trim()} ${person.lastName.trim()}`;
}

async function checkPhotos(members: Person[]): Promise<void> {
	const withCode = members.filter((member) => member.legacyId !== null);
	for (const [name, toUrl] of [
		['parlament.ch portrait-260', photoUrl],
		['rokka par stack', rokkaUrl]
	] as const) {
		const checks = await mapLimited(withCode, PHOTO_CONCURRENCY, (member) =>
			checkPhoto(toUrl(member.legacyId!))
		);
		const failures = checks.filter(
			(check) => check.status !== 200 || !check.type.startsWith('image/')
		);
		const bySha = new Map<string, number>();
		for (const check of checks) bySha.set(check.sha1, (bySha.get(check.sha1) ?? 0) + 1);
		const duplicates = checks.filter((check) => check.sha1 && bySha.get(check.sha1)! > 1);
		console.log(
			`\nPhotos via ${name}: ${checks.length - failures.length}/${checks.length} answer 200 image/*`
		);
		for (const check of failures) console.log(`  FAIL ${check.status} ${check.type} ${check.url}`);
		for (const check of duplicates) console.log(`  SAME BYTES AS ANOTHER MEMBER ${check.url}`);
	}
}

function writeFixture(name: string, data: unknown): void {
	writeFileSync(join(FIXTURE_DIR, name), JSON.stringify(data, null, '\t') + '\n');
	console.log(`  wrote ${join(FIXTURE_DIR, name)}`);
}

async function writeFixtures(): Promise<void> {
	mkdirSync(FIXTURE_DIR, { recursive: true });
	console.log('\nFixtures:');
	const query = `and(${MEMBERS_QUERY},in(id,${FIXTURE_MEMBER_IDS.join(',')}))`;
	for (const lang of LANGS) {
		for (let page = 0; ; page++) {
			const result = await getJson<Page<Person>>('/api/v1/persons', {
				lang,
				q: query,
				include: MEMBER_FIELDS,
				sort: 'id',
				size: FIXTURE_PAGE_SIZE,
				page,
				withCounts: 'true'
			});
			writeFixture(`persons-${lang}-page${page}.json`, result);
			if (!result.page.hasNext) break;
		}
	}
	const federalCouncillor = await getJson<Page<Person>>('/api/v1/persons', {
		lang: 'de',
		q: `eq(id,${FIXTURE_FEDERAL_COUNCILLOR_ID})`,
		include: `${MEMBER_FIELDS},activeFederalCouncilMandates`
	});
	writeFixture('federal-councillor-de.json', federalCouncillor);
	for (const lang of LANGS) {
		writeFixture(`councils-${lang}.json`, await getJson('/api/v1/councils', { lang }));
		writeFixture(`cantons-${lang}.json`, await getJson('/api/v1/cantons', { lang, size: 100 }));
	}
}

async function main(): Promise<void> {
	for (const lang of LANGS) {
		const councils = await getJson<Page<Keyed>>('/api/v1/councils', { lang });
		const cantons = await getJson<Page<Keyed>>('/api/v1/cantons', { lang, size: 100 });
		const show = (rows: Keyed[]) => rows.map((row) => `${row!.key}=${row!.abbreviation}`).join(' ');
		console.log(`councils ${lang}: ${show(councils.content)}`);
		console.log(`cantons  ${lang}: ${show(cantons.content)}`);
	}

	const membersByLang = new Map<string, Person[]>();
	for (const lang of LANGS) {
		const pages = await getAllPages(lang);
		const members = pages.flatMap((page) => page.content);
		membersByLang.set(lang, members);
		console.log(
			`\n${lang}: ${pages.length} pages, totalElements=${pages[0].page.totalElements}, fetched=${members.length}`
		);
	}

	const members = membersByLang.get('de')!;
	const ids = (list: Person[]) => list.map((member) => member.id).join(',');
	for (const lang of LANGS) {
		if (ids(membersByLang.get(lang)!) !== ids(members))
			console.log(`WARNING: ${lang} has another member set`);
	}

	console.log('\nCounts per council:');
	for (const [key, name] of Object.entries(COUNCIL_KEYS)) {
		console.log(`  ${name}: ${members.filter((member) => member.council?.key === key).length}`);
	}
	const notAssemblyMembers = members.filter(
		(member) => member.type?.key !== ASSEMBLY_MEMBER_TYPE_KEY
	);
	console.log(`  not an assembly member (e.g. Federal Council): ${notAssemblyMembers.length}`);
	const noCode = members.filter((member) => member.legacyId === null);
	console.log(
		`  without legacyId (no photo code): ${noCode.length} ${noCode.map(label).join('; ')}`
	);

	console.log('\nMembers (id, name, council, canton, party de/fr/it/rm, photo):');
	for (const member of members) {
		const parties = LANGS.map(
			(lang) =>
				membersByLang.get(lang)!.find((other) => other.id === member.id)?.party?.shortName ?? '∅'
		).join('/');
		const photo = member.legacyId === null ? 'NO PHOTO CODE' : photoUrl(member.legacyId);
		console.log(
			`  ${label(member)} | ${member.council?.abbreviation} | ${member.canton?.abbreviation} | ${parties} | ${photo}`
		);
	}

	if (args.has('--check-photos')) await checkPhotos(members);
	if (args.has('--write-fixtures')) await writeFixtures();
}

await main();
