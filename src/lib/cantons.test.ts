import { describe, expect, it } from 'vitest';
import { CANTONS, groupRoster, type RosterEntry } from './cantons';

const entry = (council: 'N' | 'S', canton: string, lastName: string): RosterEntry => ({
	id: lastName.length,
	hasPhoto: true,
	council,
	canton,
	firstName: 'A',
	lastName,
	party: 'SP'
});

describe('groupRoster', () => {
	it('knows the 26 cantons once each', () => {
		expect(new Set(CANTONS.map((canton) => canton.code)).size).toBe(26);
	});

	it('groups by council, then cantons in the official order, then names', () => {
		const groups = groupRoster(
			[
				entry('N', 'VD', 'Ruch'),
				entry('N', 'ZH', 'Zopfi'),
				entry('N', 'VD', 'Amaudruz'),
				entry('S', 'GE', 'Sommaruga')
			],
			'fr'
		);
		expect(groups.map((group) => [group.council, group.count])).toEqual([
			['N', 3],
			['S', 1]
		]);
		expect(groups[0].cantons.map((canton) => canton.name)).toEqual(['Zurich', 'Vaud']);
		expect(groups[0].cantons[1].members.map((member) => member.lastName)).toEqual([
			'Amaudruz',
			'Ruch'
		]);
	});

	it('names the canton in the page language and keeps an unknown code', () => {
		const groups = groupRoster([entry('S', 'GR', 'X'), entry('S', 'XX', 'Y')], 'rm');
		expect(groups[1].cantons.map((canton) => canton.name)).toEqual(['Grischun', 'XX']);
	});
});
