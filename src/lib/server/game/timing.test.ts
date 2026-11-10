import { describe, expect, it } from 'vitest';
import { ROUND_MS } from '$lib/game/protocol';
import { clockStartsAt, isLate, pointsFor, remainingMs } from './timing';

const T = new Date('2026-11-30T08:00:00Z');
const at = (ms: number) => new Date(T.getTime() + ms);

describe('clockStartsAt', () => {
	it('starts when the browser says the photo is shown', () => {
		expect(clockStartsAt({ readyAt: T, photoServedAt: at(500) }, at(1200))).toEqual(at(1200));
	});

	it('starts no later than the grace after the photo was served', () => {
		expect(clockStartsAt({ readyAt: T, photoServedAt: at(500) }, at(5000))).toEqual(at(3500));
	});

	it('counts the grace from ready when the photo was never served', () => {
		expect(clockStartsAt({ readyAt: T, photoServedAt: null }, at(4000))).toEqual(at(3000));
	});

	it('starts when the browser says so when the photo was preloaded during the reveal', () => {
		expect(clockStartsAt({ readyAt: T, photoServedAt: at(-2000) }, at(800))).toEqual(at(800));
	});

	it('gives a preloaded photo only the short grace after ready', () => {
		expect(clockStartsAt({ readyAt: T, photoServedAt: at(-2000) }, at(2500))).toEqual(at(1000));
	});

	it('gives the full grace to a photo served right when the round became ready', () => {
		expect(clockStartsAt({ readyAt: T, photoServedAt: T }, at(5000))).toEqual(at(3000));
	});

	it('never starts before the round is ready', () => {
		expect(clockStartsAt({ readyAt: T, photoServedAt: null }, at(-400))).toEqual(T);
	});
});

describe('pointsFor', () => {
	it.each([
		[300, 10],
		[1300, 9],
		[5850, 4],
		[10300, 0],
		[20000, 0],
		[-500, 10]
	])('after %i ms gives %i points', (elapsed, points) => {
		expect(pointsFor(T, at(elapsed))).toBe(points);
	});
});

describe('isLate', () => {
	it('accepts an answer within the round, the allowance and the slack', () => {
		expect(isLate(T, at(11300))).toBe(false);
	});

	it('refuses an answer after that', () => {
		expect(isLate(T, at(11301))).toBe(true);
	});
});

describe('remainingMs', () => {
	it('counts down from the full round', () => {
		expect(remainingMs(T, at(2500))).toBe(ROUND_MS - 2500);
	});

	it('stays within 0 and the full round', () => {
		expect(remainingMs(T, at(-100))).toBe(ROUND_MS);
		expect(remainingMs(T, at(ROUND_MS + 1))).toBe(0);
	});
});
