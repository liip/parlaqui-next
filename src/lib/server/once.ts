// Runs the work once and keeps the answer for the life of the process, but only when it worked. A
// rejected promise is not an empty slot: remembering one would replay the same failure forever, so the
// slot is emptied by hand. The callers already waiting on a failing attempt share it rather than each
// starting one of their own.
export function onceSucceeded<T>(work: () => Promise<T>): () => Promise<T> {
	let attempt: Promise<T> | null = null;

	const forget = (cause: unknown): never => {
		attempt = null;
		throw cause;
	};

	return () => {
		attempt ??= Promise.resolve().then(work).catch(forget);
		return attempt;
	};
}
