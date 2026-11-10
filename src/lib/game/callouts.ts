const CALLOUT_SECONDS = [5, 2];

// when, from the opening of a round, a screen reader hears the time left: once at 5 s, once at 2 s
export const timeCallouts = (remainingMs: number): { seconds: number; delayMs: number }[] =>
	CALLOUT_SECONDS.filter((seconds) => remainingMs > seconds * 1000).map((seconds) => ({
		seconds,
		delayMs: remainingMs - seconds * 1000
	}));
