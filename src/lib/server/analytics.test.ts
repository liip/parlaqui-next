import { randomBytes, randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { sql, type Db } from './db/sqlite';
import { testDb } from '../../../test/db';
import {
	OTHER_REFERRER,
	countGameStarted,
	dayOf,
	fingerprint,
	insights,
	pruneAnalytics,
	recordView,
	viewOf
} from './analytics';

const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1';
const LAPTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15';

const request = (path: string, headers: Record<string, string> = {}, method = 'GET') => {
	const url = new URL(`https://parlaqui.ch${path}`);
	return { req: new Request(url, { method, headers: { 'user-agent': PHONE, ...headers } }), url };
};
const view = (path: string, headers?: Record<string, string>, method?: string) => {
	const { req, url } = request(path, headers, method);
	return viewOf(req, url);
};

describe('viewOf', () => {
	it('counts the home and members pages, page loads and in-app navigations', () => {
		expect(view('/fr')).toEqual({ page: 'home', language: 'fr', device: 'mobile', referrer: '' });
		expect(view('/de/members', { 'user-agent': LAPTOP })).toMatchObject({
			page: 'members',
			device: 'desktop'
		});
		expect(view('/rm/members/__data.json')).toMatchObject({ page: 'members', language: 'rm' });
	});

	it('ignores everything else', () => {
		for (const path of [
			'/',
			'/en',
			'/fr/game',
			'/fr/s/x/story.jpg',
			'/it/s/AbCdEfGhIjKlMnOpQrStUv',
			'/api/game',
			'/fr/members/x',
			'/robots.txt'
		]) {
			expect(view(path)).toBeNull();
		}
		expect(view('/fr', {}, 'POST')).toBeNull();
	});

	it('ignores robots, link previews and people who ask not to be tracked', () => {
		expect(view('/fr', { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' })).toBeNull();
		expect(view('/fr', { 'user-agent': 'WhatsApp/2.23.20' })).toBeNull();
		expect(view('/fr', { 'user-agent': '' })).toBeNull();
		expect(view('/fr', { dnt: '1' })).toBeNull();
		expect(view('/fr', { 'sec-gpc': '1' })).toBeNull();
	});

	it('keeps the host of an outside referrer only', () => {
		expect(view('/fr', { referer: 'https://www.google.com/search?q=parlement' })?.referrer).toBe(
			'google.com'
		);
		expect(view('/fr', { referer: 'https://parlaqui.ch/de' })?.referrer).toBe('');
		expect(view('/fr', { referer: 'https://www.parlaqui.ch/de' })?.referrer).toBe('');
		expect(view('/fr/members/__data.json', { referer: 'https://google.com/' })?.referrer).toBe('');
		expect(view('/fr')?.referrer).toBe('');
	});

	it('keeps a plausible public host name, lower-case and without www', () => {
		const referrer = (referer: string) => view('/fr', { referer })?.referrer;
		expect(referrer('https://www.Google.com/search')).toBe('google.com');
		expect(referrer('https://news.ycombinator.com/item?id=1')).toBe('news.ycombinator.com');
		expect(referrer('android-app://com.google.android.gm/')).toBe('com.google.android.gm');
	});

	it('counts an address, a port or junk in the referrer as other, never storing it', () => {
		const referrer = (referer: string) => view('/fr', { referer })?.referrer;
		const long = `https://${Array(6).fill('a'.repeat(49)).join('.')}.com/`;
		for (const junk of [
			'https://192.0.2.44:8443/x',
			'http://192.0.2.44/',
			'http://3232235521/',
			'http://[2001:db8::1]/',
			long,
			'https://example.com:8443/',
			'https://localhost/',
			'https://foo_bar.example/',
			'https://google.com./',
			'not a url'
		]) {
			expect(referrer(junk), junk).toBe(OTHER_REFERRER);
		}
		expect(new URL(long).hostname.length).toBeGreaterThan(300);
	});
});

describe('fingerprint', () => {
	it('is stable within a day and unrelated across days', () => {
		const a = fingerprint('2026-11-30', '203.0.113.7', PHONE);
		expect(fingerprint('2026-11-30', '203.0.113.7', PHONE).equals(a)).toBe(true);
		expect(fingerprint('2026-11-30', '203.0.113.8', PHONE).equals(a)).toBe(false);
		expect(fingerprint('2026-12-01', '203.0.113.7', PHONE).equals(a)).toBe(false);
	});

	it('uses the Zurich calendar day', () => {
		expect(dayOf(new Date('2026-11-30T23:30:00Z'))).toBe('2026-12-01');
	});
});

describe('recording and reading', () => {
	let db: Db;

	beforeEach(() => {
		db = testDb();
	});

	it('adds up views, counts each visitor once a day, and joins the games', async () => {
		const home = {
			page: 'home',
			language: 'fr',
			device: 'mobile',
			referrer: 'google.com'
		} as const;
		const day = '2026-11-30';
		const alice = fingerprint(day, '203.0.113.1', PHONE);
		await recordView(db, { view: home, day, visitor: alice });
		await recordView(db, { view: home, day, visitor: alice });
		await recordView(db, {
			view: { ...home, page: 'members', referrer: '' },
			day,
			visitor: fingerprint(day, '203.0.113.2', PHONE)
		});
		const visitorId = randomUUID();
		db.run(
			sql`insert into visitor (id, token_hash, created_at) values (${visitorId}, ${randomBytes(32)}, ${new Date()})`
		);
		db.run(sql`
			insert into game (id, visitor_id, council, language, total, started_at, finished_at)
			values (${randomUUID()}, ${visitorId}, 'all', 'fr', 10, ${new Date('2026-11-30T09:00:00Z')}, ${new Date('2026-11-30T09:02:00Z')}),
				(${randomUUID()}, ${visitorId}, 'all', 'fr', 10, ${new Date('2026-11-30T10:00:00Z')}, null)
		`);
		// a third game was started that day and has been deleted since, unfinished
		for (let started = 0; started < 3; started++) {
			db.tx(() => countGameStarted(db, day));
		}

		const report = await insights(db, new Date('2026-11-30T12:00:00Z'), 2);

		expect(report.from).toBe('2026-11-29');
		expect(report.days).toEqual([
			{
				day: '2026-11-29',
				visitors: 0,
				views: { home: 0, members: 0 },
				gamesStarted: 0,
				gamesFinished: 0
			},
			{
				day: '2026-11-30',
				visitors: 2,
				views: { home: 2, members: 1 },
				gamesStarted: 3,
				gamesFinished: 1
			}
		]);
		expect(report.referrers).toEqual([{ host: 'google.com', views: 2 }]);
		expect(report.devices).toEqual({ mobile: 3 });
	});

	it('lists every day of a long span, across the changes of summer time', async () => {
		const report = await insights(db, new Date('2026-11-30T12:00:00Z'), 365);
		expect(report.days).toHaveLength(365);
		expect(report.days[0].day).toBe('2025-12-01');
		expect(report.days.at(-1)?.day).toBe('2026-11-30');
		expect(new Set(report.days.map((day) => day.day)).size).toBe(365);
	});

	it('prunes what is older than 400 days', async () => {
		const old = {
			view: { page: 'home', language: 'de', device: 'desktop', referrer: '' } as const,
			visitor: randomBytes(32)
		};
		await recordView(db, { ...old, day: '2025-10-01' });
		await recordView(db, { ...old, day: '2026-11-01' });
		db.tx(() => countGameStarted(db, '2025-10-01'));
		db.tx(() => countGameStarted(db, '2026-11-01'));
		await pruneAnalytics(db, '2026-11-30');
		expect(db.all(sql`select day from page_view`)).toEqual([{ day: '2026-11-01' }]);
		expect(db.all(sql`select day from visitor_day`)).toHaveLength(1);
		expect(db.all(sql`select day from games_started_day`)).toEqual([{ day: '2026-11-01' }]);
	});
});
