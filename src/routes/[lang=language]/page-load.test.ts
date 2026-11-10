import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = ':memory:';

const { db } = await import('$lib/server/db');
const { migrate } = await import('$lib/server/db/migrate');
const { sql } = await import('$lib/server/db/sqlite');
const { load } = await import('./+page.server');

beforeAll(() => {
	migrate(db);
});

beforeEach(() => {
	db.exec('delete from member; delete from roster_import');
});

describe('home page load', () => {
	it('home with no members says so', async () => {
		expect(await load()).toEqual({ members: 0, stale: true, asOf: null });
	});

	it('home passes the number of playable members for the rules line', async () => {
		const party = JSON.stringify({ de: 'SP' });
		const now = new Date();
		db.run(sql`
			insert into member (id, first_name, last_name, gender, council, canton, party, photo_code, active, updated_at)
			values
				(1, 'A', 'A', 'f', 'N', 'VD', ${party}, 'p1', 1, ${now}),
				(2, 'B', 'B', 'm', 'N', 'BE', ${party}, 'p2', 1, ${now}),
				(3, 'C', 'C', 'f', 'S', 'ZH', ${party}, 'p3', 1, ${now}),
				(4, 'D', 'D', 'm', 'S', 'UR', ${party}, null, 1, ${now}),
				(5, 'E', 'E', 'f', 'N', 'GE', ${party}, 'p5', 0, ${now})
		`);
		expect(await load()).toMatchObject({ members: 3 });
	});

	it('is fresh right after a published import', async () => {
		const now = new Date();
		db.run(sql`
			insert into roster_import (status, started_at, finished_at, national, states, without_photo)
			values ('published', ${now}, ${now}, 200, 46, 0)
		`);
		expect(await load()).toMatchObject({
			stale: false,
			asOf: expect.stringMatching(/^\d{2}\.\d{2}\.\d{4}$/)
		});
	});
});
