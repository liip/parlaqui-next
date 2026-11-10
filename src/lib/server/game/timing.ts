import { MAX_POINTS_PER_ROUND, ROUND_MS } from '$lib/game/protocol';

const PHOTO_GRACE_MS = 3_000;
const PRELOAD_GRACE_MS = 1_000;
const ANSWER_ALLOWANCE_MS = 300;
const LATE_SLACK_MS = 1_000;
// a near-perfect game answered faster than this on the median is no human's reading of six names;
// counting a couple of misses too, so one deliberate wrong answer no longer keeps a script ranked
export const IMPLAUSIBLE_MEDIAN_MS = 600;
export const IMPLAUSIBLE_MIN_CORRECT = 8;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const elapsedMs = (from: Date, to: Date) => to.getTime() - from.getTime();

export function clockStartsAt(
	round: { readyAt: Date; photoServedAt: Date | null },
	startCalledAt: Date
): Date {
	const ready = round.readyAt.getTime();
	const served = round.photoServedAt?.getTime() ?? ready;
	// a photo preloaded during the reveal is already in the browser when the round becomes ready
	const shownBy = served < ready ? ready + PRELOAD_GRACE_MS : served + PHOTO_GRACE_MS;
	return new Date(Math.max(ready, Math.min(startCalledAt.getTime(), shownBy)));
}

// integer arithmetic, so a tenth boundary never floors one point short
export function pointsFor(clockStartedAt: Date, answeredAt: Date): number {
	const spent = clamp(elapsedMs(clockStartedAt, answeredAt) - ANSWER_ALLOWANCE_MS, 0, ROUND_MS);
	return Math.floor(((ROUND_MS - spent) * MAX_POINTS_PER_ROUND) / ROUND_MS);
}

export function isLate(clockStartedAt: Date, answeredAt: Date): boolean {
	return elapsedMs(clockStartedAt, answeredAt) > ROUND_MS + ANSWER_ALLOWANCE_MS + LATE_SLACK_MS;
}

export const deadlineOf = (clockStartedAt: Date): number => clockStartedAt.getTime() + ROUND_MS;

export function remainingMs(clockStartedAt: Date, now: Date): number {
	return clamp(ROUND_MS - elapsedMs(clockStartedAt, now), 0, ROUND_MS);
}
