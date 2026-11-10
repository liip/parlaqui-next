import { createHash, timingSafeEqual } from 'node:crypto';
import { error } from '@sveltejs/kit';

const MIN_TOKEN_LENGTH = 32;

const digest = (value: string) => createHash('sha256').update(value).digest();

export const tokenUsable = (expected: string | undefined): expected is string =>
	(expected ?? '').length >= MIN_TOKEN_LENGTH;

// hashed before the comparison, so two tokens of different lengths still compare in constant time
export const tokenMatches = (offered: string, expected: string): boolean =>
	offered.length > 0 && timingSafeEqual(digest(offered), digest(expected));

// 404 and not 401: an answer that changes with the token tells the caller the route is there
export function requireToken(request: Request, expected: string | undefined): void {
	if (!tokenUsable(expected)) throw error(404, 'Not Found');
	const offered = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
	if (!tokenMatches(offered, expected)) throw error(404, 'Not Found');
}
