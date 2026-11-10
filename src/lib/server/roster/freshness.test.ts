import { describe, expect, it } from 'vitest';
import { asOfDay, isOverdue, isStale } from './freshness';

const NOW = new Date('2026-10-28T12:00:00Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);

describe('isStale', () => {
	it('is stale when nothing was ever published', () => {
		expect(isStale(null, NOW)).toBe(true);
	});

	it('is fresh at 71 hours', () => {
		expect(isStale(hoursAgo(71), NOW)).toBe(false);
	});

	it('is stale at 73 hours', () => {
		expect(isStale(hoursAgo(73), NOW)).toBe(true);
	});
});

describe('isOverdue', () => {
	it('is overdue when nothing was ever published', () => {
		expect(isOverdue(null, NOW)).toBe(true);
	});

	it('waits out one night: fresh at 35 hours, overdue at 37', () => {
		expect(isOverdue(hoursAgo(35), NOW)).toBe(false);
		expect(isOverdue(hoursAgo(37), NOW)).toBe(true);
	});
});

describe('asOfDay', () => {
	it('gives the Zurich day of the last publish, in Swiss form', () => {
		expect(asOfDay(new Date('2026-11-03T23:30:00Z'))).toBe('04.11.2026');
		expect(asOfDay(new Date('2026-11-03T10:00:00Z'))).toBe('03.11.2026');
	});

	it('gives nothing before a first publish', () => {
		expect(asOfDay(null)).toBeNull();
	});
});
