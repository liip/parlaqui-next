import { describe, expect, it } from 'vitest';
import { forgetBusy, rememberBusy, takeBusy } from './busy';

describe('busy photo tokens', () => {
	it('hands a token back once, and never one that was forgotten or never refused', () => {
		rememberBusy('a');
		rememberBusy('b');
		forgetBusy('b');

		expect(takeBusy('a')).toBe(true);
		expect(takeBusy('a')).toBe(false);
		expect(takeBusy('b')).toBe(false);
		expect(takeBusy('never')).toBe(false);
		expect(takeBusy(null)).toBe(false);
	});

	it('hands a token back again to the same attempt, never to another one', () => {
		rememberBusy('c');

		expect(takeBusy('c', 'attempt-1')).toBe(true);
		expect(takeBusy('c', 'attempt-1')).toBe(true);
		expect(takeBusy('c', 'attempt-2')).toBe(false);
		expect(takeBusy('c')).toBe(false);
	});

	it('keeps only the latest 2 000 tokens', () => {
		for (let i = 0; i <= 2_000; i++) rememberBusy(`t${i}`);

		expect(takeBusy('t0')).toBe(false);
		expect(takeBusy('t1')).toBe(true);
		expect(takeBusy('t2000')).toBe(true);
	});
});
