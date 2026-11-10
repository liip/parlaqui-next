import { zurichDay } from '../zurich';

const HOUR_MS = 60 * 60 * 1000;

const olderThan =
	(limitMs: number) =>
	(lastPublished: Date | null, now: Date): boolean =>
		lastPublished === null || now.getTime() - lastPublished.getTime() > limitMs;

// what the home page tells visitors
export const isStale = olderThan(72 * HOUR_MS);

// what the monitoring alerts on: the import runs every night, so 36 hours means one was missed
export const isOverdue = olderThan(36 * HOUR_MS);

// the date the Parliament's terms require next to its data, as the Zurich day of the last publish
export const asOfDay = (lastPublished: Date | null): string | null =>
	lastPublished && zurichDay(lastPublished).split('-').reverse().join('.');
