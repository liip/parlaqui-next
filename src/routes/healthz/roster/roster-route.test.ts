import { beforeAll, describe, expect, it, vi } from 'vitest';

process.env.DATABASE_PATH = ':memory:';

const { db } = await import('$lib/server/db');
const { sql } = await import('$lib/server/db/sqlite');
const { migration } = await import('$lib/server/db/ready');
const { GET } = await import('./+server');

const NOW = new Date('2026-11-04T12:00:00Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);
const get = () => (GET as unknown as () => Promise<Response>)();

function published(at: Date) {
	db.run(sql`
		insert into roster_import (started_at, finished_at, status, national, states)
		values (${at}, ${at}, 'published', 200, 46)
	`);
}

describe('GET /healthz/roster', () => {
	beforeAll(async () => {
		await migration();
		vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
	});

	it('answers 503 before any roster was published', async () => {
		const response = await get();

		expect(response.status).toBe(503);
		expect(await response.text()).toBe('roster import overdue, last published never');
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it('answers 503 once the last publish is older than a missed night', async () => {
		published(hoursAgo(40));

		const response = await get();

		expect(response.status).toBe(503);
		expect(await response.text()).toContain('last published 2026-11-02T20:00:00.000Z');
	});

	it('answers ok after a fresh publish, a failed import later on changing nothing', async () => {
		published(hoursAgo(10));
		db.run(sql`
			insert into roster_import (started_at, finished_at, status, detail)
			values (${hoursAgo(1)}, ${hoursAgo(1)}, 'failed', 'parliament API down')
		`);

		const response = await get();

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('ok, last published 2026-11-04T02:00:00.000Z');
	});

	it('answers 503 once the database is out of reach', async () => {
		db.close();

		expect((await get()).status).toBe(503);
	});
});
