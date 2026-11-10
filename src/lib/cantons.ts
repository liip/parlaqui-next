import type { Language } from '$lib/i18n';

// the official order of the cantons; Romansh names still to be reviewed with the other Romansh texts
export const CANTONS: { code: string; name: Record<Language, string> }[] = [
	{ code: 'ZH', name: { de: 'Zürich', fr: 'Zurich', it: 'Zurigo', rm: 'Turitg' } },
	{ code: 'BE', name: { de: 'Bern', fr: 'Berne', it: 'Berna', rm: 'Berna' } },
	{ code: 'LU', name: { de: 'Luzern', fr: 'Lucerne', it: 'Lucerna', rm: 'Lucerna' } },
	{ code: 'UR', name: { de: 'Uri', fr: 'Uri', it: 'Uri', rm: 'Uri' } },
	{ code: 'SZ', name: { de: 'Schwyz', fr: 'Schwytz', it: 'Svitto', rm: 'Sviz' } },
	{ code: 'OW', name: { de: 'Obwalden', fr: 'Obwald', it: 'Obvaldo', rm: 'Obwalden' } },
	{ code: 'NW', name: { de: 'Nidwalden', fr: 'Nidwald', it: 'Nidvaldo', rm: 'Nidwalden' } },
	{ code: 'GL', name: { de: 'Glarus', fr: 'Glaris', it: 'Glarona', rm: 'Glaruna' } },
	{ code: 'ZG', name: { de: 'Zug', fr: 'Zoug', it: 'Zugo', rm: 'Zug' } },
	{ code: 'FR', name: { de: 'Freiburg', fr: 'Fribourg', it: 'Friburgo', rm: 'Friburg' } },
	{ code: 'SO', name: { de: 'Solothurn', fr: 'Soleure', it: 'Soletta', rm: 'Soloturn' } },
	{
		code: 'BS',
		name: { de: 'Basel-Stadt', fr: 'Bâle-Ville', it: 'Basilea Città', rm: 'Basilea-Citad' }
	},
	{
		code: 'BL',
		name: {
			de: 'Basel-Landschaft',
			fr: 'Bâle-Campagne',
			it: 'Basilea Campagna',
			rm: 'Basilea-Champagna'
		}
	},
	{ code: 'SH', name: { de: 'Schaffhausen', fr: 'Schaffhouse', it: 'Sciaffusa', rm: 'Schaffusa' } },
	{
		code: 'AR',
		name: {
			de: 'Appenzell Ausserrhoden',
			fr: 'Appenzell Rhodes-Extérieures',
			it: 'Appenzello Esterno',
			rm: 'Appenzell dador'
		}
	},
	{
		code: 'AI',
		name: {
			de: 'Appenzell Innerrhoden',
			fr: 'Appenzell Rhodes-Intérieures',
			it: 'Appenzello Interno',
			rm: 'Appenzell dadens'
		}
	},
	{ code: 'SG', name: { de: 'St. Gallen', fr: 'Saint-Gall', it: 'San Gallo', rm: 'Son Gagl' } },
	{ code: 'GR', name: { de: 'Graubünden', fr: 'Grisons', it: 'Grigioni', rm: 'Grischun' } },
	{ code: 'AG', name: { de: 'Aargau', fr: 'Argovie', it: 'Argovia', rm: 'Argovia' } },
	{ code: 'TG', name: { de: 'Thurgau', fr: 'Thurgovie', it: 'Turgovia', rm: 'Turgovia' } },
	{ code: 'TI', name: { de: 'Tessin', fr: 'Tessin', it: 'Ticino', rm: 'Tessin' } },
	{ code: 'VD', name: { de: 'Waadt', fr: 'Vaud', it: 'Vaud', rm: 'Vad' } },
	{ code: 'VS', name: { de: 'Wallis', fr: 'Valais', it: 'Vallese', rm: 'Vallais' } },
	{ code: 'NE', name: { de: 'Neuenburg', fr: 'Neuchâtel', it: 'Neuchâtel', rm: 'Neuchâtel' } },
	{ code: 'GE', name: { de: 'Genf', fr: 'Genève', it: 'Ginevra', rm: 'Genevra' } },
	{ code: 'JU', name: { de: 'Jura', fr: 'Jura', it: 'Giura', rm: 'Giura' } }
];

export const CANTON_CODES: readonly string[] = CANTONS.map(({ code }) => code);

export type RosterEntry = {
	id: number;
	hasPhoto: boolean;
	council: 'N' | 'S';
	canton: string;
	firstName: string;
	lastName: string;
	party: string;
};

type CantonGroup = { code: string; name: string; members: RosterEntry[] };
type CouncilGroup = { council: 'N' | 'S'; count: number; cantons: CantonGroup[] };

const order = new Map(CANTONS.map(({ code }, index) => [code, index]));

// a canton the list does not know still shows, after the known ones, under its code
export function groupRoster(entries: RosterEntry[], language: Language): CouncilGroup[] {
	return (['N', 'S'] as const).map((council) => {
		const members = entries.filter((entry) => entry.council === council);
		const codes = [...new Set(members.map((entry) => entry.canton))].sort(
			(a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99) || a.localeCompare(b)
		);
		return {
			council,
			count: members.length,
			cantons: codes.map((code) => ({
				code,
				name: CANTONS.find((canton) => canton.code === code)?.name[language] ?? code,
				members: members
					.filter((entry) => entry.canton === code)
					.sort(
						(a, b) =>
							a.lastName.localeCompare(b.lastName, language) ||
							a.firstName.localeCompare(b.firstName, language)
					)
			}))
		};
	});
}
