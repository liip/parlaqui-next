const MAX_TOKENS = 2_000;

// round photos refused because the server was busy, so a browser giving up on one is handed the
// same round again instead of spending the game's only replacement on a photo that was fine
const busy = new Set<string>();
// the attempts already handed their round back, so the same request sent again after its response
// was lost gets the same answer instead of spending the replacement
const handedBack = new Set<string>();

const keep = (set: Set<string>, key: string) => {
	set.delete(key);
	set.add(key);
	if (set.size > MAX_TOKENS) set.delete(set.values().next().value as string);
};

export function rememberBusy(token: string): void {
	keep(busy, token);
}

export function forgetBusy(token: string): void {
	busy.delete(token);
}

// once only: a photo that keeps failing without reaching the server again is replaced next time
export function takeBusy(token: string | null, attempt: string | null = null): boolean {
	if (!token) return false;
	const key = attempt && `${token}:${attempt}`;
	if (key && handedBack.has(key)) return true;
	if (!busy.delete(token)) return false;
	if (key) keep(handedBack, key);
	return true;
}
