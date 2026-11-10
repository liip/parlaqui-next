import { describe, expect, it } from 'vitest';
import { sessionOf, sessionValid } from './insights-session';

const TOKEN = 'a'.repeat(48);
const NOW = new Date('2026-11-30T08:00:00Z');
const later = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);

describe('insights session', () => {
	it('holds for eight hours and not a second more', () => {
		const session = sessionOf(TOKEN, NOW);
		expect(sessionValid(session, TOKEN, later(7.9))).toBe(true);
		expect(sessionValid(session, TOKEN, later(8.01))).toBe(false);
	});

	it('never contains the token and fails with another token', () => {
		const session = sessionOf(TOKEN, NOW);
		expect(session).not.toContain(TOKEN);
		expect(sessionValid(session, 'b'.repeat(48), NOW)).toBe(false);
	});

	it('refuses a forged time, a changed signature, a future time and garbage', () => {
		const [, signed] = sessionOf(TOKEN, NOW).split('.');
		expect(sessionValid(`${later(-1).getTime()}.${signed}`, TOKEN, NOW)).toBe(false);
		expect(sessionValid(`${NOW.getTime()}.${signed.replace(/./, 'x')}`, TOKEN, NOW)).toBe(false);
		expect(sessionValid(sessionOf(TOKEN, later(1)), TOKEN, NOW)).toBe(false);
		for (const junk of [undefined, '', 'x', '.', 'abc.def', `${NOW.getTime()}.`]) {
			expect(sessionValid(junk, TOKEN, NOW)).toBe(false);
		}
	});
});
