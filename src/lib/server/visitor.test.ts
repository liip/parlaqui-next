import { createHash } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sql, type Db } from './db/sqlite';
import { testDb } from '../../../test/db';
import { VISITOR_COOKIE, ensureVisitor, findVisitor } from './visitor';

let db: Db;

function fakeCookies(initial?: string) {
	const jar = new Map<string, string>();
	if (initial !== undefined) jar.set(VISITOR_COOKIE, initial);
	const options: Record<string, unknown> = {};
	const cookies = {
		get: (name: string) => jar.get(name),
		set: (name: string, value: string, opts: Record<string, unknown>) => {
			jar.set(name, value);
			Object.assign(options, opts);
		}
	} as unknown as Cookies;
	return { cookies, jar, options };
}

beforeEach(() => {
	db = testDb();
});

describe('ensureVisitor', () => {
	it('creates one visitor and sets the cookie', async () => {
		const { cookies, jar, options } = fakeCookies();

		const id = await ensureVisitor(db, cookies);

		expect(db.all(sql`select id from visitor`)).toEqual([{ id }]);
		expect(jar.get(VISITOR_COOKIE)).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(options).toEqual({
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 30
		});
	});

	it('reuses the visitor of a valid cookie', async () => {
		const first = fakeCookies();
		const id = await ensureVisitor(db, first.cookies);
		const token = first.jar.get(VISITOR_COOKIE);

		expect(await ensureVisitor(db, fakeCookies(token).cookies)).toBe(id);
		expect(await findVisitor(db, token)).toBe(id);
		expect(db.all(sql`select id from visitor`)).toHaveLength(1);
	});

	it('renews the cookie of a known visitor', async () => {
		const first = fakeCookies();
		await ensureVisitor(db, first.cookies);
		const token = first.jar.get(VISITOR_COOKIE);

		const again = fakeCookies(token);
		const set = vi.spyOn(again.cookies, 'set');
		await ensureVisitor(db, again.cookies);

		expect(set).toHaveBeenCalledWith(VISITOR_COOKIE, token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 30
		});
	});

	it('an unknown or malformed cookie gets a new visitor', async () => {
		const { cookies, jar } = fakeCookies('not-a-token');

		const id = await ensureVisitor(db, cookies);

		expect(await findVisitor(db, 'not-a-token')).toBeNull();
		expect(await findVisitor(db, undefined)).toBeNull();
		expect(jar.get(VISITOR_COOKIE)).not.toBe('not-a-token');
		expect(await findVisitor(db, jar.get(VISITOR_COOKIE))).toBe(id);
	});

	it('the stored hash is not the token', async () => {
		const { cookies, jar } = fakeCookies();
		await ensureVisitor(db, cookies);
		const token = jar.get(VISITOR_COOKIE)!;

		const row = db.get<{ token_hash: Buffer }>(sql`select token_hash from visitor`)!;

		expect(Buffer.from(row.token_hash)).toEqual(createHash('sha256').update(token).digest());
		expect(Buffer.from(row.token_hash).toString('base64url')).not.toBe(token);
	});
});
