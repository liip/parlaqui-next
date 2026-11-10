import { describe, expect, it } from 'vitest';
import { requireToken, tokenMatches, tokenUsable } from './token';

const TOKEN = 'k'.repeat(40);
const request = (authorization?: string) =>
	new Request('https://parlaqui.ch/api/x', authorization ? { headers: { authorization } } : {});

describe('token', () => {
	it('is usable from 32 characters on', () => {
		expect(tokenUsable(undefined)).toBe(false);
		expect(tokenUsable('x'.repeat(31))).toBe(false);
		expect(tokenUsable('x'.repeat(32))).toBe(true);
	});

	it('matches only the exact token, and never an empty offer', () => {
		expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
		expect(tokenMatches(`${TOKEN}x`, TOKEN)).toBe(false);
		expect(tokenMatches('', TOKEN)).toBe(false);
	});

	it('answers 404 for a missing, wrong or unset token', () => {
		expect(() => requireToken(request(`Bearer ${TOKEN}`), TOKEN)).not.toThrow();
		for (const [offered, expected] of [
			[undefined, TOKEN],
			['Bearer nope', TOKEN],
			[`Bearer ${TOKEN}`, 'short']
		] as const) {
			expect(() => requireToken(request(offered), expected)).toThrow(
				expect.objectContaining({ status: 404 })
			);
		}
	});
});
