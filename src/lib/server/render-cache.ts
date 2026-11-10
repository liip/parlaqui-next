export class RenderOverload extends Error {
	constructor() {
		super('too many renders waiting');
	}
}

// what a route answers when its queue is full, instead of letting requests pile up in memory
export const overloaded = () =>
	new Response('busy', { status: 503, headers: { 'retry-after': '2' } });

// one render per key at a time, a few renders at once, a bounded queue behind them, and the
// latest results kept in memory
export function createRenderCache(options: {
	size: number;
	concurrency: number;
	maxWaiting: number;
}) {
	const done = new Map<string, Buffer>();
	const pending = new Map<string, Promise<Buffer>>();
	const waiting: (() => void)[] = [];
	let running = 0;

	const slot = async () => {
		if (running < options.concurrency) {
			running++;
			return;
		}
		await new Promise<void>((resolve) => waiting.push(resolve));
	};
	const release = () => {
		const next = waiting.shift();
		if (next) next();
		else running--;
	};

	// a result already rendered or under way, so a caller can skip fetching what the render needs
	const peek = (key: string): Promise<Buffer> | undefined => {
		const cached = done.get(key);
		if (cached) return Promise.resolve(cached);
		return pending.get(key);
	};

	const cache = async (key: string, render: () => Promise<Buffer>): Promise<Buffer> => {
		const ready = peek(key);
		if (ready) return ready;
		if (running >= options.concurrency && waiting.length >= options.maxWaiting) {
			throw new RenderOverload();
		}

		const work = (async () => {
			await slot();
			try {
				const image = await render();
				done.set(key, image);
				if (done.size > options.size) done.delete(done.keys().next().value as string);
				return image;
			} finally {
				release();
				pending.delete(key);
			}
		})();
		pending.set(key, work);
		return work;
	};
	return Object.assign(cache, { peek });
}
