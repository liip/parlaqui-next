import { beforeAll, describe, expect, it } from 'vitest';

const TOKEN = 'a'.repeat(40);

process.env.DATABASE_PATH = ':memory:';
process.env.INSIGHTS_TOKEN = TOKEN;

const { db } = await import('$lib/server/db');
const { migrate } = await import('$lib/server/db/migrate');
const { sql } = await import('$lib/server/db/sqlite');
const { dayOf } = await import('$lib/server/analytics');
const { sessionOf } = await import('$lib/server/insights-session');
const { load } = await import('./+page.server');

beforeAll(() => {
	migrate(db);
});

describe('audience page', () => {
	it('names the referrers that are no public host "autre", the page being in French', async () => {
		const day = dayOf(new Date());
		db.run(sql`
			insert into page_view (day, page, language, referrer, device, views)
			values (${day}, 'home', 'fr', 'other', 'mobile', 3), (${day}, 'home', 'fr', 'google.com', 'mobile', 2)
		`);
		const session = sessionOf(TOKEN, new Date());
		const event = {
			cookies: { get: () => session },
			url: new URL('https://parlaqui.ch/insights')
		} as unknown as Parameters<typeof load>[0];

		const { report } = await load(event);

		expect(report.referrers).toEqual([
			{ host: 'other', views: 3, label: 'autre' },
			{ host: 'google.com', views: 2, label: 'google.com' }
		]);
	});
});
