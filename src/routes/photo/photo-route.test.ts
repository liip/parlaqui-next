import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Crop } from '$lib/server/photo/variant';

process.env.DATABASE_PATH = ':memory:';

const loadSource = vi.fn();
const forgetSource = vi.fn();
vi.mock('$lib/server/photo/source', () => ({
	loadSource: (code: string, hash: string | null) => loadSource(code, hash),
	forgetSource: (code: string) => forgetSource(code)
}));
const renderVariant = vi.fn();
vi.mock('$lib/server/photo/variant', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/photo/variant')>()),
	renderVariant: (source: Buffer, crop: Crop) => renderVariant(source, crop)
}));

const { db } = await import('$lib/server/db');
const { migrate } = await import('$lib/server/db/migrate');
const { sql } = await import('$lib/server/db/sqlite');
const { dealRounds } = await import('$lib/server/game/deal');
const { createGame } = await import('$lib/server/game/store');
const { rememberBusy, takeBusy } = await import('$lib/server/photo/busy');
const actualVariant = await vi.importActual<typeof import('$lib/server/photo/variant')>(
	'$lib/server/photo/variant'
);
const { GET } = await import('./[token]/+server');

const get = (token: string) =>
	(GET as unknown as (event: unknown) => Promise<Response>)({ params: { token } });

async function dealtTokens(count: number): Promise<string[]> {
	const visitor = db.get<{ id: string }>(
		sql`insert into visitor (id, token_hash, created_at) values (${randomUUID()}, ${randomBytes(32)}, ${new Date()}) returning id`
	)!;
	const members = db
		.all<{ id: number; gender: string; photo_code: string }>(
			sql`select id, gender, photo_code from member`
		)
		.map((m) => ({ id: m.id, gender: m.gender, photoCode: m.photo_code }));
	const rounds = dealRounds(members as never, count);
	await createGame(db, {
		visitorId: visitor.id,
		council: 'all',
		language: 'fr',
		rounds,
		now: new Date()
	});
	const dealt = db.all<{ photo_token: string }>(
		sql`select photo_token from game_round order by id desc limit ${count}`
	);
	return dealt.map((round) => round.photo_token);
}

const dealtToken = async () => (await dealtTokens(1))[0];

const jpeg = () =>
	sharp({ create: { width: 300, height: 400, channels: 3, background: '#888' } })
		.jpeg()
		.toBuffer();

function gate() {
	let open = () => {};
	const opened = new Promise<void>((resolve) => (open = resolve));
	return { opened, open };
}

function gated(source: Buffer) {
	const { opened, open } = gate();
	loadSource.mockImplementation(async () => {
		await opened;
		return source;
	});
	return open;
}

const roundOf = (token: string) =>
	db.get<{ photo_code: string; photo_served_at: number | null }>(
		sql`select photo_code, photo_served_at from game_round where photo_token = ${token}`
	)!;

const codeOf = async (token: string): Promise<string> => roundOf(token).photo_code;

const servedAt = async (token: string) => roundOf(token).photo_served_at;

beforeAll(() => {
	migrate(db);
});

beforeEach(async () => {
	loadSource.mockReset();
	forgetSource.mockReset();
	renderVariant.mockReset();
	renderVariant.mockImplementation(actualVariant.renderVariant);
	db.exec('delete from game_round; delete from game; delete from visitor; delete from member');
	for (let id = 1; id <= 20; id++) {
		db.run(sql`
			insert into member (id, first_name, last_name, gender, council, canton, party, photo_code, updated_at)
			values (${id}, ${`First${id}`}, ${`Last${id}`}, 'f', 'N', 'GE',
				${JSON.stringify({ de: 'SP', fr: 'PS' })}, ${`p${id}`}, ${new Date()})
		`);
	}
});

describe('GET /photo/:token', () => {
	it('serves a JPEG for a dealt round and records photo_served_at', async () => {
		loadSource.mockResolvedValue(await jpeg());
		const token = await dealtToken();
		expect(await servedAt(token)).toBeNull();

		const response = await get(token);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/jpeg');
		expect(response.headers.get('cache-control')).toBe('private, max-age=3600');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		const meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
		expect([meta.width, meta.height]).toEqual([240, 240]);
		expect(await servedAt(token)).not.toBeNull();
	});

	it('asks for the portrait uploaded to rokka while it matches the round photo code', async () => {
		loadSource.mockRejectedValue(new Error('down'));
		const hash = 'a'.repeat(40);
		db.run(sql`update member set photo_hash = ${hash}`);
		const token = await dealtToken();
		const round = roundOf(token);
		await expect(get(token)).rejects.toMatchObject({ status: 502 });
		expect(loadSource).toHaveBeenLastCalledWith(round.photo_code, hash);

		db.run(sql`update member set photo_code = 'changed'`);
		await expect(get(token)).rejects.toMatchObject({ status: 502 });
		expect(loadSource).toHaveBeenLastCalledWith(round.photo_code, null);
	});

	it('serves a photo already rendered even when its source no longer answers', async () => {
		loadSource.mockResolvedValue(await jpeg());
		const token = await dealtToken();
		expect((await get(token)).status).toBe(200);
		loadSource.mockReset();
		loadSource.mockRejectedValue(new Error('down'));

		expect((await get(token)).status).toBe(200);
		expect(loadSource).not.toHaveBeenCalled();
	});

	it('404 for a malformed or unknown token', async () => {
		await expect(get('short')).rejects.toMatchObject({ status: 404 });
		await expect(get('A'.repeat(22))).rejects.toMatchObject({ status: 404 });
		expect(loadSource).not.toHaveBeenCalled();
	});

	it('502 when the source is down', async () => {
		loadSource.mockRejectedValue(new Error('down'));
		await expect(get(await dealtToken())).rejects.toMatchObject({ status: 502 });
	});

	it('a source failure does not record photo_served_at', async () => {
		loadSource.mockRejectedValue(new Error('down'));
		const token = await dealtToken();
		await expect(get(token)).rejects.toMatchObject({ status: 502 });
		expect(await servedAt(token)).toBeNull();
	});

	it('a 502 logs the photo code and the cause, never the token', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		loadSource.mockRejectedValue(new Error('down'));
		const token = await dealtToken();
		const round = roundOf(token);

		await expect(get(token)).rejects.toMatchObject({ status: 502 });

		expect(warn).toHaveBeenCalledTimes(1);
		const line = String(warn.mock.calls[0][0]);
		expect(line).toContain(round.photo_code);
		expect(line).toContain('down');
		expect(line).not.toContain(token);
		warn.mockRestore();
	});

	it('a source that cannot be rendered is dropped from the source cache', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		loadSource.mockResolvedValue(Buffer.from('not an image'));
		const token = await dealtToken();
		const round = roundOf(token);

		await expect(get(token)).rejects.toMatchObject({ status: 502 });

		expect(forgetSource).toHaveBeenCalledWith(round.photo_code);
		vi.mocked(console.warn).mockRestore();
	});

	// a random token may contain a short code or id by chance, so this checks it is random instead
	it('the URL is 16 random bytes, not the photo code', async () => {
		const tokens = [await dealtToken(), await dealtToken()];
		const rounds = db.all<{ photo_token: string; photo_code: string }>(
			sql`select photo_token, photo_code from game_round`
		);

		for (const token of tokens) {
			expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
			expect(Buffer.from(token, 'base64url')).toHaveLength(16);
		}
		expect(tokens[0]).not.toBe(tokens[1]);
		for (const round of rounds) expect(round.photo_token).not.toBe(round.photo_code);
	});

	it('renders a photo asked for many times at once only once, and keeps it for the round', async () => {
		const open = gated(await jpeg());
		const token = await dealtToken();

		const requests = Array.from({ length: 10 }, () => get(token));
		await vi.waitFor(() => expect(loadSource).toHaveBeenCalled());
		// lets every request reach the render before the source answers
		await new Promise((resolve) => setTimeout(resolve, 50));
		open();
		const images = await Promise.all(
			requests.map(async (request) => Buffer.from(await (await request).arrayBuffer()))
		);
		await get(token);

		expect(renderVariant).toHaveBeenCalledTimes(1);
		expect(images.every((image) => image.equals(images[0]))).toBe(true);
	});

	it('a slow source does not hold a render slot, so other photos are served meanwhile', async () => {
		const tokens = await dealtTokens(5);
		const slowCodes = new Set(await Promise.all(tokens.slice(0, 4).map(codeOf)));
		const slow = gate();
		const source = await jpeg();
		loadSource.mockImplementation(async (code: string) => {
			if (slowCodes.has(code)) await slow.opened;
			return source;
		});

		const waiting = tokens.slice(0, 4).map((token) => get(token));
		await vi.waitFor(() => expect(loadSource).toHaveBeenCalledTimes(4));
		const timeout = new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 2_000));
		const served = await Promise.race([get(tokens[4]).then((r) => r.status), timeout]);
		slow.open();
		await Promise.all(waiting);

		expect(served).toBe(200);
	});

	it('answers 503 with retry-after when too many photos wait, and remembers the token', async () => {
		loadSource.mockResolvedValue(await jpeg());
		const renders = gate();
		renderVariant.mockImplementation(async (source: Buffer, crop: Crop) => {
			await renders.opened;
			return actualVariant.renderVariant(source, crop);
		});
		const tokens: string[] = [];
		while (tokens.length < 405) tokens.push(...(await dealtTokens(20)));
		const asked = tokens.slice(0, 405);

		const requests = asked.map((token) => get(token));
		const refused = await Promise.race(requests);
		renders.open();
		const statuses = (await Promise.all(requests)).map((response) => response.status);

		expect(refused.status).toBe(503);
		expect(refused.headers.get('retry-after')).toBe('2');
		expect(statuses.filter((status) => status === 200)).toHaveLength(404);
		expect(forgetSource).not.toHaveBeenCalled();
		const refusedToken = asked[statuses.indexOf(503)];
		expect(await servedAt(refusedToken)).toBeNull();
		expect(takeBusy(refusedToken)).toBe(true);
		expect(takeBusy(asked[statuses.indexOf(200)])).toBe(false);
	});

	it('a photo served or failing for good is no longer remembered as refused for load', async () => {
		loadSource.mockResolvedValue(await jpeg());
		const [served, failed] = await dealtTokens(2);
		rememberBusy(served);
		rememberBusy(failed);

		expect((await get(served)).status).toBe(200);
		loadSource.mockRejectedValue(new Error('down'));
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		await expect(get(failed)).rejects.toMatchObject({ status: 502 });
		vi.mocked(console.warn).mockRestore();

		expect(takeBusy(served)).toBe(false);
		expect(takeBusy(failed)).toBe(false);
	});
});
