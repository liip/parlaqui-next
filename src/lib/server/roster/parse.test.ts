import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '$lib/i18n';
import { parseSnapshot } from './parse';
import type { RawSnapshot } from './types';

type Page = { content: unknown[] };
type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function readFixture(name: string): Page {
	return JSON.parse(
		readFileSync(new URL(`../../../../test/fixtures/parl/${name}.json`, import.meta.url), 'utf8')
	);
}

function snapshot(): RawSnapshot {
	const pages = (lang: string) => [
		...readFixture(`persons-${lang}-page0`).content,
		...readFixture(`persons-${lang}-page1`).content
	];
	return { de: pages('de'), fr: pages('fr'), it: pages('it'), rm: pages('rm') };
}

function parseMembers(raw: RawSnapshot) {
	return parseSnapshot(raw).members;
}

function find(members: ReturnType<typeof parseMembers>, id: number) {
	const member = members.find((candidate) => candidate.id === id);
	if (!member) throw new Error(`member ${id} missing`);
	return member;
}

function withDe(raw: RawSnapshot, id: number, change: (record: Loose) => void): RawSnapshot {
	const de = structuredClone(raw.de) as Loose[];
	const record = de.find((candidate) => candidate.id === id);
	if (!record) throw new Error(`record ${id} missing`);
	change(record);
	return { ...raw, de };
}

describe('parseMembers', () => {
	it('parses Maillard', () => {
		const maillard = find(parseMembers(snapshot()), 491);

		expect(maillard).toEqual({
			id: 491,
			firstName: 'Pierre-Yves',
			lastName: 'Maillard',
			gender: 'm',
			council: 'S',
			canton: 'VD',
			party: { de: 'SP', fr: 'PSS', it: 'PSS', rm: 'SP' },
			photoCode: '2513'
		});
	});

	it('matches the documented result for the six fixture members', () => {
		const members = parseMembers(snapshot());

		expect(members.map((member) => member.id)).toEqual([491, 3891, 4265, 10817, 15601, 18110]);
		expect(find(members, 4265)).toMatchObject({ gender: 'f', council: 'N', canton: 'GR' });
		expect(find(members, 10817)).toMatchObject({ lastName: 'Chappuis', photoCode: '10817' });
		expect(find(members, 18110)).toMatchObject({ canton: 'TI', photoCode: '18110' });
	});

	it('excludes Federal Council members', () => {
		const raw = snapshot();
		const federal = readFixture('federal-councillor-de').content;
		const members = parseMembers({ ...raw, de: [...raw.de, ...federal] });

		expect(members.map((member) => member.id)).not.toContain(4062);
		expect(members).toHaveLength(6);
	});

	it('reports no problem for a clean snapshot with a Federal Council member', () => {
		const raw = snapshot();
		const federal = readFixture('federal-councillor-de').content;

		expect(parseSnapshot({ ...raw, de: [...raw.de, ...federal] })).toMatchObject({
			problems: [],
			incomplete: 0
		});
	});

	it('falls back to the German party name', () => {
		const chappuis = find(parseMembers(snapshot()), 10817);

		expect(chappuis.party.rm).toBe(chappuis.party.de);
	});

	it('falls back to the German party name when the language record is missing', () => {
		const raw = snapshot();
		const fr = raw.fr.filter((record) => (record as { id: number }).id !== 491);

		expect(find(parseMembers({ ...raw, fr }), 491).party.fr).toBe('SP');
	});

	it('merges languages by id', () => {
		const members = parseMembers(snapshot());

		expect(members).toHaveLength(6);
		for (const member of members) {
			expect(Object.keys(member.party).sort()).toEqual([...LANGUAGES].sort());
		}
	});

	it('uses the party name for a member without party, never "-"', () => {
		const jositsch = find(parseMembers(snapshot()), 3891);

		expect(jositsch.party).toEqual({
			de: 'parteilos',
			fr: 'sans parti',
			it: 'senza partito',
			rm: 'parteilos'
		});
	});

	it('takes the canton from German, never from Romansh', () => {
		const raw = snapshot();
		const rmCantons = raw.rm.map((record) => (record as Loose).canton.abbreviation);

		expect(rmCantons.every((abbreviation) => abbreviation === null)).toBe(true);
		expect(parseMembers(raw).every((member) => member.canton.length === 2)).toBe(true);
	});

	it('leaves photoCode null without legacyId, never falling back to id', () => {
		const raw = withDe(snapshot(), 491, (record) => {
			record.legacyId = null;
		});
		const noKey = withDe(snapshot(), 491, (record) => {
			delete record.legacyId;
		});

		expect(find(parseMembers(raw), 491).photoCode).toBeNull();
		expect(find(parseMembers(noKey), 491).photoCode).toBeNull();
	});

	it('drops and reports a council member whose id is not a positive integer', () => {
		for (const badId of [0, -3, 1.5, '491', null]) {
			const raw = withDe(snapshot(), 491, (record) => {
				record.id = badId;
			});

			const parsed = parseSnapshot(raw);
			expect(parsed.members).toHaveLength(5);
			expect(parsed.problems).toEqual([`1 incomplete council member records: ${badId}`]);
		}
	});

	it('drops a person missing a required field', () => {
		const noName = withDe(snapshot(), 491, (record) => {
			record.lastName = ' ';
		});
		const noCanton = withDe(snapshot(), 491, (record) => {
			record.canton = null;
		});
		const noGender = withDe(snapshot(), 491, (record) => {
			record.gender = null;
		});
		const noParty = withDe(snapshot(), 491, (record) => {
			record.party = { shortName: null, name: null };
		});

		for (const raw of [noName, noCanton, noGender, noParty]) {
			const parsed = parseSnapshot(raw);
			expect(parsed.members).toHaveLength(5);
			expect(parsed.incomplete).toBe(1);
			expect(parsed.problems).toEqual(['1 incomplete council member records: 491']);
		}
	});

	it('names every incomplete council member', () => {
		const raw = withDe(
			withDe(snapshot(), 491, (record) => (record.firstName = null)),
			18110,
			(r) => {
				r.canton = null;
			}
		);

		expect(parseSnapshot(raw).problems).toEqual([
			'2 incomplete council member records: 491, 18110'
		]);
	});

	it('counts a member record without a known council but does not reject it', () => {
		const raw = withDe(snapshot(), 491, (record) => {
			record.council = null;
		});

		expect(parseSnapshot(raw)).toMatchObject({ problems: [], incomplete: 1 });
		expect(parseMembers(raw)).toHaveLength(5);
	});

	it('reports ids repeated within a language', () => {
		const raw = snapshot();
		const fr = [...raw.fr, raw.fr[0], raw.fr[2]];
		const de = [...raw.de, raw.de[1]];
		const ids = (records: unknown[], ...indexes: number[]) =>
			indexes.map((i) => (records[i] as Loose).id).join(', ');

		expect(parseSnapshot({ ...raw, de, fr }).problems).toEqual([
			`de records repeat ids ${ids(raw.de, 1)}`,
			`fr records repeat ids ${ids(raw.fr, 0, 2)}`
		]);
	});
});
