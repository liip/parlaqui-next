import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// the hook reads the shared db instance, so this file gives it a database of its own before importing it
process.env.DATABASE_PATH = ':memory:';
process.env.ORIGIN = 'https://parlaqui.ch';
// the timers started by init() would otherwise import the roster from the real parliament API
delete process.env.PARL_API_KEY;

const { db } = await import('$lib/server/db');
const { sql } = await import('$lib/server/db/sqlite');
const { handle, init } = await import('./hooks.server');
const { VISITOR_COOKIE, hashOf } = await import('$lib/server/visitor');
const { migration } = await import('$lib/server/db/ready');

let served = 0;

async function visit(arrival?: {
	host?: string;
	proto?: string;
	path?: string;
	method?: string;
	address?: string;
	cookie?: string;
	agent?: string;
	encoding?: string;
	page?: { body: string; type: string; etag?: string };
	noAddress?: boolean;
}) {
	const cookiesSet: string[] = [];
	const event = {
		// adapter-node prefixes the raw path with ORIGIN, so it never carries the host the visitor typed
		url: new URL('https://parlaqui.ch' + (arrival?.path ?? '/')),
		getClientAddress: () => {
			if (arrival?.noAddress) throw new Error('Address header was missing');
			return arrival?.address ?? '203.0.113.1';
		},
		locals: {},
		cookies: {
			get: (name: string) => (name === VISITOR_COOKIE ? arrival?.cookie : undefined),
			set: (name: string) => cookiesSet.push(name)
		},
		request: {
			method: arrival?.method ?? 'GET',
			headers: {
				get: (name: string) => {
					const header = name.toLowerCase();
					if (header === 'host') return arrival?.host ?? null;
					if (header === 'x-forwarded-proto') return arrival?.proto ?? null;
					if (header === 'accept-encoding') return arrival?.encoding ?? null;
					return header === 'user-agent' ? (arrival?.agent ?? null) : null;
				}
			}
		}
	};
	const resolve = async () => {
		served++;
		return arrival?.page
			? new Response(arrival.page.body, {
					headers: {
						'content-type': arrival.page.type,
						...(arrival.page.etag ? { etag: arrival.page.etag } : {})
					}
				})
			: new Response('ok');
	};

	const response = await handle({ event, resolve } as unknown as Parameters<typeof handle>[0]);
	return Object.assign(response, {
		cookiesSet,
		locals: event.locals as { visitorId?: string | null }
	});
}

const STALE_DAY = '2020-01-01';

const knownVisitor = (token: string) =>
	db.get<{ id: string }>(sql`
		insert into visitor (id, token_hash, created_at)
		values (${randomUUID()}, ${hashOf(token)}, ${new Date()}) returning id
	`)!;

beforeAll(async () => {
	await migration();
	// left for the prunes, which only start in the test that lets them
	db.run(sql`
		insert into page_view (day, page, language, device, views)
		values (${STALE_DAY}, 'home', 'de', 'desktop', 1)
	`);
	db.run(sql`
		insert into game (id, council, language, total, started_at)
		values (${randomUUID()}, 'all', 'de', 10, ${new Date(STALE_DAY)})
	`);
});

describe('handle', () => {
	it('redirects a non-canonical host to ORIGIN with 308', async () => {
		const before = served;

		await expect(
			visit({ host: 'parlaqui.internal.example.test', path: '/quiz?lang=fr' })
		).rejects.toMatchObject({
			status: 308,
			location: 'https://parlaqui.ch/quiz?lang=fr'
		});

		// the redirect leaves before the page is built, so nothing was served
		expect(served).toBe(before);
	});

	it.each(['//evil.example/x', '/\\evil.example', '/%2F%2Fevil.example'])(
		'keeps the redirect of %s on ORIGIN',
		async (path) => {
			const refusal = await visit({ host: 'www.parlaqui.ch', path }).catch((thrown) => thrown);

			expect(refusal.status).toBe(308);
			const target = new URL(refusal.location);
			expect(target.origin).toBe('https://parlaqui.ch');
			expect(refusal.location).toMatch(/^https:\/\/parlaqui\.ch\/[^/\\]/);
		}
	);

	it.each([
		['/index.html', '/'],
		['/parlament.jpg', '/images/og.jpg']
	])('sends the old address %s on to %s for good', async (path, target) => {
		await expect(visit({ path })).rejects.toMatchObject({ status: 301, location: target });
	});

	it('sends plain http on the canonical host to https with 308', async () => {
		await expect(
			visit({ host: 'parlaqui.ch', proto: 'http', path: '/de?x=1' })
		).rejects.toMatchObject({ status: 308, location: 'https://parlaqui.ch/de?x=1' });
	});

	it('serves the canonical host over https, and without a scheme header', async () => {
		expect((await visit({ host: 'parlaqui.ch', proto: 'https' })).status).toBe(200);
		expect((await visit({ host: 'parlaqui.ch' })).status).toBe(200);
	});

	it('gzips a page for a browser that accepts it, and the page reads back the same', async () => {
		const html = '<!doctype html><p>' + 'Nationalrat '.repeat(500) + '</p>';
		const page = { body: html, type: 'text/html' };

		const response = await visit({ page, encoding: 'gzip, deflate, br' });

		expect(response.headers.get('content-encoding')).toBe('gzip');
		expect(response.headers.get('vary')).toContain('Accept-Encoding');
		const packed = new Uint8Array(await response.arrayBuffer());
		expect(packed.length).toBeLessThan(html.length / 10);
		expect(gunzipSync(packed).toString()).toBe(html);
	});

	it('sends a page plain without accept-encoding, and never gzips an image', async () => {
		const plain = await visit({ page: { body: '<p>x</p>', type: 'text/html' } });
		expect(plain.headers.get('content-encoding')).toBeNull();
		// a cache must not hand this plain copy to a browser that takes gzip
		expect(plain.headers.get('vary')).toContain('Accept-Encoding');
		expect(await plain.text()).toBe('<p>x</p>');

		const image = await visit({ page: { body: 'jpeg', type: 'image/jpeg' }, encoding: 'gzip' });
		expect(image.headers.get('content-encoding')).toBeNull();
	});

	it('sends a page plain to a browser that refuses gzip with q=0', async () => {
		const page = { body: '<p>x</p>', type: 'text/html' };
		for (const encoding of ['gzip;q=0, identity', 'br, GZIP; q=0.0', 'identity']) {
			expect((await visit({ page, encoding })).headers.get('content-encoding')).toBeNull();
		}
		for (const encoding of ['gzip;q=0.5', '*', 'deflate, *;q=1']) {
			expect((await visit({ page, encoding })).headers.get('content-encoding')).toBe('gzip');
		}
	});

	it("drops the plain page's ETag from the gzipped one, whose bytes differ", async () => {
		const page = { body: '<p>x</p>', type: 'text/html', etag: '"abc"' };
		expect((await visit({ page, encoding: 'gzip' })).headers.get('etag')).toBeNull();
		expect((await visit({ page })).headers.get('etag')).toBe('"abc"');
	});

	it('does not redirect a loopback host', async () => {
		const before = served;

		const response = await visit({ host: '127.0.0.1:3000' });

		expect(response.status).toBe(200);
		expect(served).toBe(before + 1);
	});

	it('refuses the 61st game start from one visitor with 429', async () => {
		const start = () =>
			visit({ path: '/api/game', method: 'POST', address: '198.51.100.7', cookie: 'visitor-a' });

		for (let i = 0; i < 60; i++) expect((await start()).status).toBe(200);
		const refused = await start();

		expect(refused.status).toBe(429);
		expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
		expect(await refused.json()).toEqual({ message: 'game.tooFast' });
		const other = { path: '/api/game', method: 'POST', address: '198.51.100.7', cookie: 'b' };
		expect((await visit(other)).status).toBe(200);
	});

	it('allows 61 game starts from 61 visitors behind one address', async () => {
		for (let i = 0; i < 61; i++) {
			const response = await visit({
				path: '/api/game',
				method: 'POST',
				address: '198.51.100.20',
				cookie: `class-${i}`
			});
			expect(response.status).toBe(200);
		}
	});

	it('refuses the 1801st game start from one IPv6 /64, with or without a cookie', async () => {
		// known devices, so the cap on new devices stays out of the way
		const devices = Array.from({ length: 40 }, (_, i) => `ipv6-device-${i}`);
		for (const token of devices) knownVisitor(token);
		const start = (i: number) =>
			visit({
				path: '/api/game',
				method: 'POST',
				address: `2001:db8:0:7::${(i + 1).toString(16)}`,
				cookie: i % 20 === 0 ? undefined : devices[i % devices.length]
			});

		for (let i = 0; i < 1800; i++) expect((await start(i)).status).toBe(200);

		expect((await start(1800)).status).toBe(429);
		const elsewhere = { path: '/api/game', method: 'POST', address: '2001:db8:0:8::1' };
		expect((await visit(elsewhere)).status).toBe(200);
	});

	it('serves game traffic when the address cannot be read, and says so once', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const first = await visit({ path: '/api/game/x', noAddress: true, cookie: 'no-address' });
		const second = await visit({ path: '/photo/x', noAddress: true, cookie: 'no-address' });

		expect([first.status, second.status]).toEqual([200, 200]);
		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});

	it('a page view sets no visitor cookie', async () => {
		const response = await visit({ path: '/de' });

		expect(response.cookiesSet).toEqual([]);
	});

	it('refuses the 9001st game request from one address in a minute, a visitor at 301', async () => {
		const address = '198.51.100.30';
		for (let i = 0; i < 9000; i++) {
			expect((await visit({ path: '/photo/x', address })).status).toBe(200);
		}
		expect((await visit({ path: '/photo/x', address })).status).toBe(429);

		const player = { path: '/api/game/x', address: '198.51.100.31', cookie: 'fast-player' };
		for (let i = 0; i < 300; i++) expect((await visit(player)).status).toBe(200);
		expect((await visit(player)).status).toBe(429);
	});

	it('gives portraits their own budget of 10 000 a minute per address, apart from score images', async () => {
		const address = '198.51.100.77';
		const card = '/fr/s/AbCdEfGhIjKlMnOpQrStUv/story.jpg';
		for (let i = 0; i < 10_000; i++) {
			expect((await visit({ path: '/portrait/1', address })).status).toBe(200);
		}
		expect((await visit({ path: '/portrait/1', address })).status).toBe(429);
		expect((await visit({ path: '/portrait/1', address: '198.51.100.78' })).status).toBe(200);

		for (let i = 0; i < 1200; i++) expect((await visit({ path: card, address })).status).toBe(200);
		expect((await visit({ path: card, address })).status).toBe(429);
		expect((await visit({ path: '/fr/s/AbCdEfGhIjKlMnOpQrStUv', address })).status).toBe(429);
	});

	it('writes one line a minute counting the refusals per limit, without any address', async () => {
		vi.useFakeTimers({ toFake: ['setInterval'] });
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'info').mockImplementation(() => {});
		try {
			await init();
			// the refusals of earlier tests go out in the first line
			vi.advanceTimersByTime(60_000);
			warn.mockClear();
			const address = '198.51.100.140';
			const login = { path: '/insights/login', method: 'POST', address };
			for (let i = 0; i < 13; i++) await visit(login);

			vi.advanceTimersByTime(60_000);
			vi.advanceTimersByTime(60_000);

			expect(warn.mock.calls).toEqual([
				['flood protection refused 3 requests in the last minute: insightsLogins 3']
			]);
		} finally {
			vi.useRealTimers();
			vi.restoreAllMocks();
		}
	});

	it('prunes old figures and abandoned games from a timer started at startup, without any page view', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => {});
		// the database is already open, so this only lets init() start the prunes
		delete process.env.DATABASE_PATH;
		try {
			await init();
			await vi.waitFor(() => {
				expect(db.all(sql`select 1 from page_view where day = ${STALE_DAY}`)).toHaveLength(0);
				expect(db.all(sql`select 1 from game where finished_at is null`)).toHaveLength(0);
			});
		} finally {
			process.env.DATABASE_PATH = ':memory:';
			vi.restoreAllMocks();
		}
	});

	it('starts no prune timer on a database in memory', async () => {
		vi.useFakeTimers({ toFake: ['setInterval'] });
		vi.spyOn(console, 'info').mockImplementation(() => {});
		try {
			await init();
			expect(vi.getTimerCount()).toBe(1);
		} finally {
			vi.useRealTimers();
			vi.restoreAllMocks();
		}
	});

	it('says at startup where the address comes from', async () => {
		vi.useFakeTimers({ toFake: ['setInterval'] });
		const info = vi.spyOn(console, 'info').mockImplementation(() => {});
		try {
			await init();
			process.env.ADDRESS_HEADER = 'X-Forwarded-For';
			await init();
		} finally {
			delete process.env.ADDRESS_HEADER;
			vi.useRealTimers();
		}
		expect(String(info.mock.calls[0][0])).toContain('ADDRESS_HEADER is not set');
		expect(String(info.mock.calls[1][0])).toContain('X-Forwarded-For');
		info.mockRestore();
	});

	it('allows ten audience logins per address in ten minutes', async () => {
		const address = '198.51.100.90';
		const statuses = [];
		for (let i = 0; i < 11; i++) {
			statuses.push((await visit({ path: '/insights/login', method: 'POST', address })).status);
		}
		expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
		expect(statuses[10]).toBe(429);
		expect(
			(await visit({ path: '/insights/login', method: 'POST', address: '198.51.100.91' })).status
		).toBe(200);
	});

	it('lets one address make 100 new devices an hour, while known devices keep playing', async () => {
		const address = '198.51.100.130';
		const fresh = () => visit({ path: '/api/game', method: 'POST', address });
		for (let i = 0; i < 100; i++) expect((await fresh()).status).toBe(200);
		const refused = await visit({ path: '/api/game', method: 'POST', address, cookie: 'made-up' });
		expect(refused.status).toBe(429);
		expect(Number(refused.headers.get('retry-after'))).toBe(3600);

		const token = 'known-device-130';
		knownVisitor(token);
		expect(
			(await visit({ path: '/api/game', method: 'POST', address, cookie: token })).status
		).toBe(200);
	});

	it('applies the limits to a percent-encoded path, which the router decodes', async () => {
		const address = '198.51.100.120';
		const statuses = [];
		for (let i = 0; i < 11; i++) {
			statuses.push((await visit({ path: '/insights/%6cogin', method: 'POST', address })).status);
		}
		expect(statuses[10]).toBe(429);

		const start = () =>
			visit({ path: '/%61pi/game', method: 'POST', address: '198.51.100.121', cookie: 'encoded' });
		for (let i = 0; i < 60; i++) await start();
		expect((await start()).status).toBe(429);

		expect((await visit({ path: '/de/g%61me' })).headers.get('x-robots-tag')).toBe('noindex');
		expect((await visit({ path: '/%69nsights' })).headers.get('cache-control')).toBe(
			'private, no-store'
		);
	});

	it('answers 400 to a path that cannot be decoded', async () => {
		expect((await visit({ path: '/api/game/%E0%A4%A' })).status).toBe(400);
		// before the host redirect, whose throw would not be caught for such a path either
		expect((await visit({ path: '/%E0%A4%A', host: 'www.parlaqui.ch' })).status).toBe(400);
	});

	it('sends the security headers on every response', async () => {
		const page = await visit({ path: '/de' });
		const refused = await visit({
			path: '/insights/login',
			method: 'POST',
			address: '198.51.100.99'
		});

		for (const response of [page, refused]) {
			expect(response.headers.get('strict-transport-security')).toBe(
				'max-age=31536000; includeSubDomains'
			);
			expect(response.headers.get('x-content-type-options')).toBe('nosniff');
			expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
			expect(response.headers.get('permissions-policy')).toBe(
				'camera=(), microphone=(), geolocation=(), interest-cohort=()'
			);
		}
		expect(page.headers.get('cache-control')).toBeNull();
	});

	it('keeps the audience pages out of every cache', async () => {
		for (const path of ['/insights', '/insights/login', '/insights/__data.json']) {
			expect((await visit({ path })).headers.get('cache-control')).toBe('private, no-store');
		}
	});

	it('sends no HSTS when ORIGIN is plain http', async () => {
		process.env.ORIGIN = 'http://localhost:4397';
		try {
			const response = await visit({ host: 'localhost:4397', path: '/de' });
			expect(response.headers.get('strict-transport-security')).toBeNull();
		} finally {
			process.env.ORIGIN = 'https://parlaqui.ch';
		}
	});

	it('counts at most 1 000 page views per address and day', { timeout: 30_000 }, async () => {
		const browser = { path: '/de', agent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0' };
		const views = () =>
			db.get<{ n: number }>(
				sql`select coalesce(sum(views), 0) as n from page_view where day > ${STALE_DAY}`
			)!.n;
		for (let i = 0; i < 1005; i++) {
			expect((await visit({ ...browser, address: '198.51.100.150' })).status).toBe(200);
		}
		await visit({ ...browser, address: '198.51.100.151' });

		await vi.waitFor(() => expect(views()).toBeGreaterThanOrEqual(1001), {
			timeout: 10_000
		});
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(views()).toBe(1001);
	});

	it('looks the visitor up for the game API only, not for media, files or the health check', async () => {
		await migration();
		const visitor = knownVisitor('known');
		const visitorOf = async (path: string) =>
			(await visit({ path, cookie: 'known', address: '198.51.100.120' })).locals.visitorId;

		expect(await visitorOf('/api/game/x/summary')).toBe(visitor.id);
		for (const path of [
			'/photo/x',
			'/portrait/1',
			'/healthz',
			'/_app/immutable/start.js',
			'/favicon.png',
			'/fr/s/AbCdEfGhIjKlMnOpQrStUv/story.jpg'
		]) {
			expect(await visitorOf(path)).toBeFalsy();
		}
	});
});
