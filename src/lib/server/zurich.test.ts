import { describe, expect, it } from 'vitest';
import { endOfZurichDay, startOfZurichDay, zurichDay, zurichMonth } from './zurich';

describe('zurich time', () => {
	it('reads the Zurich day, not the UTC one', () => {
		expect(zurichDay(new Date('2026-11-30T23:30:00Z'))).toBe('2026-12-01');
		expect(zurichDay(new Date('2026-07-31T21:59:59Z'))).toBe('2026-07-31');
		expect(zurichDay(new Date('2026-07-31T22:00:00Z'))).toBe('2026-08-01');
	});

	it('finds the midnights of winter and summer days', () => {
		expect(startOfZurichDay('2026-11-30').toISOString()).toBe('2026-11-29T23:00:00.000Z');
		expect(endOfZurichDay('2026-11-30').toISOString()).toBe('2026-11-30T23:00:00.000Z');
		expect(startOfZurichDay('2026-07-01').toISOString()).toBe('2026-06-30T22:00:00.000Z');
	});

	it('the days of a clock change are 23 and 25 hours long', () => {
		const hours = (day: string) =>
			(endOfZurichDay(day).getTime() - startOfZurichDay(day).getTime()) / 3_600_000;
		expect(hours('2026-03-29')).toBe(23);
		expect(hours('2026-10-25')).toBe(25);
	});

	it('ends a month at the first midnight of the next, across the year end', () => {
		const { start, end } = zurichMonth(new Date('2026-12-31T23:30:00Z'));
		expect(start.toISOString()).toBe('2026-12-31T23:00:00.000Z');
		expect(end.toISOString()).toBe('2027-01-31T23:00:00.000Z');

		const october = zurichMonth(new Date('2026-10-15T12:00:00Z'));
		expect(october.start.toISOString()).toBe('2026-09-30T22:00:00.000Z');
		expect(october.end.toISOString()).toBe('2026-10-31T23:00:00.000Z');
	});
});
