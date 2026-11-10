import { createHmac, timingSafeEqual } from 'node:crypto';

export const INSIGHTS_COOKIE = 'pq.insights';
export const SESSION_SECONDS = 60 * 60 * 8;

const signature = (token: string, issuedAt: number) =>
	createHmac('sha256', token).update(`insights-session:${issuedAt}`).digest('base64url');

// "issued-at.signature": the server checks the age itself, so a copied cookie dies after 8 hours
export const sessionOf = (token: string, now: Date): string => {
	const issuedAt = now.getTime();
	return `${issuedAt}.${signature(token, issuedAt)}`;
};

export function sessionValid(cookie: string | undefined, token: string, now: Date): boolean {
	const [issued, signed] = (cookie ?? '').split('.');
	const issuedAt = Number(issued);
	if (!Number.isSafeInteger(issuedAt) || !signed) return false;
	const age = now.getTime() - issuedAt;
	if (age < 0 || age > SESSION_SECONDS * 1000) return false;
	const expected = Buffer.from(signature(token, issuedAt));
	const offered = Buffer.from(signed);
	return offered.length === expected.length && timingSafeEqual(offered, expected);
}
