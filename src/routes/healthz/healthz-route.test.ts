import { describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = ':memory:';

const { db } = await import('$lib/server/db');
const { sql } = await import('$lib/server/db/sqlite');
const { GET } = await import('./+server');

const get = () => (GET as unknown as () => Promise<Response>)();

describe('GET /healthz', () => {
	it('applies the migrations and answers ok', async () => {
		const response = await get();

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('ok');
		const row = db.get<{ count: number }>(sql`select count(*) as count from schema_migration`);
		expect(row?.count).toBeGreaterThan(0);
	});

	it('answers 503 once the database is out of reach', async () => {
		db.close();

		const response = await get();

		expect(response.status).toBe(503);
		expect(response.headers.get('cache-control')).toBe('no-store');
	});
});
