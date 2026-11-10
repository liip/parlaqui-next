import { LANGUAGES, type Language } from '$lib/i18n';
import type { Council, ParsedMember, RawSnapshot } from './types';

const MEMBER_TYPE_KEY = '1731013';
const COUNCILS: Record<string, Council> = { '1311000': 'N', '1311001': 'S' };
const GENDERS: Record<string, 'f' | 'm'> = { '1621001': 'm', '1621002': 'f' };

type Raw = {
	id?: unknown;
	legacyId?: unknown;
	firstName?: unknown;
	lastName?: unknown;
	type?: { key?: unknown } | null;
	gender?: { key?: unknown } | null;
	council?: { key?: unknown } | null;
	canton?: { abbreviation?: unknown } | null;
	party?: { shortName?: unknown; name?: unknown } | null;
};

type ParsedSnapshot = {
	members: ParsedMember[];
	// reasons to reject the snapshot found while parsing
	problems: string[];
	// member records dropped for a missing or invalid field
	incomplete: number;
};

function text(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function partyName(record: Raw | undefined): string {
	const shortName = text(record?.party?.shortName);
	return shortName && shortName !== '-' ? shortName : text(record?.party?.name);
}

function isPersonId(id: unknown): id is number {
	return typeof id === 'number' && Number.isInteger(id) && id > 0;
}

function indexById(records: Raw[]): Map<number, Raw> {
	const byId = new Map<number, Raw>();
	for (const record of records) {
		if (typeof record?.id === 'number') byId.set(record.id, record);
	}
	return byId;
}

function repeatedIds(records: Raw[]): number[] {
	const seen = new Set<number>();
	const repeated = new Set<number>();
	for (const record of records) {
		if (typeof record?.id !== 'number') continue;
		if (seen.has(record.id)) repeated.add(record.id);
		seen.add(record.id);
	}
	return [...repeated];
}

function parseMember(id: number, de: Raw, byLanguage: Record<Language, Map<number, Raw>>) {
	const council = COUNCILS[String(de.council?.key)];
	const gender = GENDERS[String(de.gender?.key)];
	const firstName = text(de.firstName);
	const lastName = text(de.lastName);
	const canton = text(de.canton?.abbreviation);
	const germanParty = partyName(de);
	if (!council || !gender || !firstName || !lastName || !canton || !germanParty) return null;

	const party = Object.fromEntries(
		LANGUAGES.map((lang) => [lang, partyName(byLanguage[lang].get(id)) || germanParty])
	) as Record<Language, string>;
	const photoCode = typeof de.legacyId === 'number' ? String(de.legacyId) : null;

	return { id, firstName, lastName, gender, council, canton, party, photoCode };
}

export function parseSnapshot(raw: RawSnapshot): ParsedSnapshot {
	const records = Object.fromEntries(
		LANGUAGES.map((lang) => [lang, (raw[lang] ?? []) as Raw[]])
	) as Record<Language, Raw[]>;
	const byLanguage = Object.fromEntries(
		LANGUAGES.map((lang) => [lang, indexById(records[lang])])
	) as Record<Language, Map<number, Raw>>;

	const problems = LANGUAGES.flatMap((lang) => {
		const repeated = repeatedIds(records[lang]);
		return repeated.length > 0 ? [`${lang} records repeat ids ${repeated.join(', ')}`] : [];
	});

	const members: ParsedMember[] = [];
	const incomplete: Raw[] = [];
	for (const de of records.de) {
		// Federal Council members and other non-members are not part of the roster
		if (de?.type?.key !== MEMBER_TYPE_KEY) continue;
		const member = isPersonId(de.id) ? parseMember(de.id, de, byLanguage) : null;
		if (member) members.push(member);
		else incomplete.push(de);
	}

	const broken = incomplete
		.filter((record) => COUNCILS[String(record.council?.key)])
		.map((record) => String(record.id));
	if (broken.length > 0) {
		problems.push(`${broken.length} incomplete council member records: ${broken.join(', ')}`);
	}

	members.sort((a, b) => a.id - b.id);
	return { members, problems, incomplete: incomplete.length };
}
