import { CANTON_CODES } from '$lib/cantons';
import type { Council, ParsedMember } from './types';

// Seat counts with a tolerance for vacancies (seats awaiting a replacement).
const SEATS: Record<Council, { name: string; min: number; max: number }> = {
	N: { name: 'Nationalrat', min: 195, max: 200 },
	S: { name: 'Ständerat', min: 44, max: 46 }
};

export const validateSnapshot = (
	members: ParsedMember[]
): { ok: true } | { ok: false; reasons: string[] } => {
	const reasons: string[] = [];

	if (members.length === 0) reasons.push('snapshot is empty');

	for (const council of ['N', 'S'] as const) {
		const { name, min, max } = SEATS[council];
		const count = members.filter((m) => m.council === council).length;
		if (count < min || count > max) {
			reasons.push(`${name} has ${count} members, expected ${min} to ${max}`);
		}
	}

	const unknown = new Set(members.map((m) => m.canton).filter((c) => !CANTON_CODES.includes(c)));
	if (unknown.size > 0) reasons.push(`unknown cantons: ${[...unknown].join(', ')}`);

	return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
};
