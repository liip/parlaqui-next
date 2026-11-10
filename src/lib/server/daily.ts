// runs once per day key, counts as done only when it succeeds, and waits before trying again
export function createDailyTask(
	run: () => Promise<void>,
	{ retryMs, onError }: { retryMs: number; onError: (cause: unknown) => void }
) {
	let doneFor = '';
	let running = false;
	let lastFailure = -Infinity;

	return (day: string, now: number): void => {
		if (doneFor === day || running || now - lastFailure < retryMs) return;
		running = true;
		void run()
			.then(() => {
				doneFor = day;
			})
			.catch((cause) => {
				lastFailure = now;
				onError(cause);
			})
			.finally(() => {
				running = false;
			});
	};
}

// runs now and then every `everyMs`; the timer never keeps the process alive on its own
export function repeat(tick: () => void, everyMs: number): NodeJS.Timeout {
	tick();
	const timer = setInterval(tick, everyMs);
	timer.unref();
	return timer;
}
