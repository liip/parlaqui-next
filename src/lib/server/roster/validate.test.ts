import { describe, expect, it } from 'vitest';
import type { Council, ParsedMember } from './types';
import { CANTON_CODES } from '$lib/cantons';
import { validateSnapshot } from './validate';

let nextId = 1;
const member = (council: Council, overrides: Partial<ParsedMember> = {}): ParsedMember => ({
	id: nextId++,
	firstName: 'Anna',
	lastName: 'Muster',
	gender: 'f',
	council,
	canton: 'VD',
	party: { de: 'X', fr: 'X', it: 'X', rm: 'X' },
	photoCode: null,
	...overrides
});

const roster = (n: number, s: number) => [
	...Array.from({ length: n }, () => member('N')),
	...Array.from({ length: s }, () => member('S'))
];

describe('validateSnapshot', () => {
	it('accepts a full roster', () => {
		expect(validateSnapshot(roster(200, 46))).toEqual({ ok: true });
	});

	it('tolerates vacancies', () => {
		expect(validateSnapshot(roster(195, 44))).toEqual({ ok: true });
	});

	it('refuses too few or too many Nationalrat members', () => {
		for (const n of [194, 201]) {
			const result = validateSnapshot(roster(n, 46));
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.reasons.join()).toContain('Nationalrat');
		}
	});

	it('refuses too few or too many Ständerat members', () => {
		for (const s of [43, 47]) {
			const result = validateSnapshot(roster(200, s));
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.reasons.join()).toContain('Ständerat');
		}
	});

	it('accepts every canton of the shared list', () => {
		const members = CANTON_CODES.map((canton) => member('N', { canton }));
		expect(validateSnapshot([...members, ...roster(200 - members.length, 46)])).toEqual({
			ok: true
		});
	});

	it('refuses an unknown canton', () => {
		const members = roster(200, 46);
		members[0].canton = 'XX';
		const result = validateSnapshot(members);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reasons.join()).toContain('XX');
	});

	it('refuses an empty list', () => {
		expect(validateSnapshot([]).ok).toBe(false);
	});

	it('reports every failing reason', () => {
		const members = roster(190, 46);
		members[0].canton = 'XX';
		const result = validateSnapshot(members);
		expect(!result.ok && result.reasons).toHaveLength(2);
	});
});
