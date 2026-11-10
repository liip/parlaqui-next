const DEFAULT_MAX_KEYS = 10_000;

export function createLimiter({
	limit,
	windowMs,
	maxKeys = DEFAULT_MAX_KEYS
}: {
	limit: number;
	windowMs: number;
	maxKeys?: number;
}) {
	const hits = new Map<string, number[]>();

	// true when the request is allowed
	function hit(key: string, now: number): boolean {
		const recent = (hits.get(key) ?? []).filter((at) => at > now - windowMs);
		hits.delete(key);

		if (recent.length >= limit) {
			hits.set(key, recent);
			return false;
		}

		recent.push(now);
		hits.set(key, recent);
		if (hits.size > maxKeys) hits.delete(hits.keys().next().value!);
		return true;
	}

	return { hit };
}

// counts refusals by limit name only, so the log shows a flood without naming who caused it
export function createRefusalTally() {
	const counts = new Map<string, number>();

	function count(name: string): void {
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}

	// the line for the period since the last call, or null when nothing was refused
	function summary(): string | null {
		if (counts.size === 0) return null;
		const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
		const parts = [...counts].map(([name, n]) => `${name} ${n}`).join(', ');
		counts.clear();
		return `flood protection refused ${total} requests in the last minute: ${parts}`;
	}

	return { count, summary };
}

const MAPPED_IPV4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;

const groupsOf = (part: string) => (part ? part.split(':') : []);

// one IPv6 subscriber usually holds a whole /64, so its addresses share one bucket
export function addressBucket(address: string): string {
	const mapped = MAPPED_IPV4.exec(address);
	if (mapped) return mapped[1];
	if (!address.includes(':')) return address;

	const [head, tail = ''] = address.replace(/%.*$/, '').split('::');
	const known = [...groupsOf(head), ...groupsOf(tail)];
	const width = known.reduce((sum, group) => sum + (group.includes('.') ? 2 : 1), 0);
	const groups = [...groupsOf(head), ...Array(Math.max(8 - width, 0)).fill('0'), ...groupsOf(tail)];
	const prefix = groups.slice(0, 4).map((group) => parseInt(group, 16).toString(16));
	return `${prefix.join(':')}::/64`;
}
