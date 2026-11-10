import { describe, expect, it } from 'vitest';
import { timeCallouts } from './callouts';

describe('timeCallouts', () => {
	it('calls out 5 and 2 seconds before the end of a full round', () => {
		expect(timeCallouts(10_000)).toEqual([
			{ seconds: 5, delayMs: 5_000 },
			{ seconds: 2, delayMs: 8_000 }
		]);
	});

	it('skips a moment already past when the round opens late', () => {
		expect(timeCallouts(4_200)).toEqual([{ seconds: 2, delayMs: 2_200 }]);
		expect(timeCallouts(5_000)).toEqual([{ seconds: 2, delayMs: 3_000 }]);
	});

	it('says nothing when less than 2 seconds are left', () => {
		expect(timeCallouts(1_500)).toEqual([]);
		expect(timeCallouts(0)).toEqual([]);
	});
});
