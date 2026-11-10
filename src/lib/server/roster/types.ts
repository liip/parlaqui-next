import type { Language } from '$lib/i18n';

export type Council = 'N' | 'S';
export type ParsedMember = {
	id: number; // ws.parl.ch person id
	firstName: string;
	lastName: string;
	gender: 'f' | 'm';
	council: Council;
	canton: string; // two-letter abbreviation, e.g. 'VD'
	party: Record<Language, string>;
	photoCode: string | null;
};
export type RawSnapshot = Record<Language, unknown[]>; // all pages, per language
