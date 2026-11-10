import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { sql, type Db } from './db/sqlite';

export const VISITOR_COOKIE = 'pq.visitor';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export const hashOf = (token: string) => createHash('sha256').update(token).digest();

export async function findVisitor(db: Db, token: string | undefined): Promise<string | null> {
	if (!token) return null;

	const row = db.get<{ id: string }>(
		sql`select id from visitor where token_hash = ${hashOf(token)}`
	);
	return row?.id ?? null;
}

const setVisitorCookie = (cookies: Cookies, token: string) =>
	cookies.set(VISITOR_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: MAX_AGE_SECONDS
	});

// renewed on each new game, so the device keeps its record while the player keeps playing
export async function ensureVisitor(db: Db, cookies: Cookies): Promise<string> {
	const current = cookies.get(VISITOR_COOKIE);
	const existing = await findVisitor(db, current);
	if (existing && current) {
		setVisitorCookie(cookies, current);
		return existing;
	}

	const token = randomBytes(32).toString('base64url');
	const id = randomUUID();
	db.run(
		sql`insert into visitor (id, token_hash, created_at) values (${id}, ${hashOf(token)}, ${new Date()})`
	);
	setVisitorCookie(cookies, token);
	return id;
}
