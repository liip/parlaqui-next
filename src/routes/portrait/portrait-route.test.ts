import sharp from 'sharp';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.DATABASE_PATH = ':memory:';

const loadSource = vi.fn();
vi.mock('$lib/server/photo/source', () => ({
	loadSource: (code: string, hash: string | null) => loadSource(code, hash)
}));

const { db } = await import('$lib/server/db');
const { migrate } = await import('$lib/server/db/migrate');
const { sql } = await import('$lib/server/db/sqlite');
const { GET } = await import('./[id]/+server');

const get = (id: string) =>
	(GET as unknown as (event: unknown) => Promise<Response>)({ params: { id } });

const insertMember = (id: number, code: string | null, active: boolean) =>
	db.run(sql`
		insert into member (id, first_name, last_name, gender, council, canton, party, photo_code, photo_hash, active, updated_at)
		values (${id}, 'F', 'L', 'f', 'N', 'GE', ${JSON.stringify({ de: 'SP' })}, ${code}, ${code ? 'h'.repeat(40) : null}, ${active}, ${new Date()})
	`);

beforeAll(() => {
	migrate(db);
});

beforeEach(async () => {
	loadSource.mockReset();
	loadSource.mockResolvedValue(
		await sharp({ create: { width: 260, height: 260, channels: 3, background: '#888' } })
			.jpeg()
			.toBuffer()
	);
	db.exec('delete from member');
	for (const [id, code, active] of [
		[1, 'p1', true],
		[2, null, true],
		[3, 'p3', false],
		[4, 'p4', true]
	] as const) {
		insertMember(id, code, active);
	}
});

describe('GET /portrait/:id', () => {
	it("serves a small square of an active member's rokka copy, cacheable for a day", async () => {
		const response = await get('1');
		expect(response.headers.get('cache-control')).toBe('public, max-age=86400');
		const meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
		expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 112, 112]);
		expect(loadSource).toHaveBeenCalledWith('p1', 'h'.repeat(40));
	});

	it('404 for a member without photo, a former member, an unknown or malformed id', async () => {
		for (const id of ['2', '3', '99', 'abc', '1;drop']) {
			await expect(get(id)).rejects.toMatchObject({ status: 404 });
		}
	});

	it('serves a portrait already rendered even when its source no longer answers', async () => {
		expect((await get('1')).status).toBe(200);
		loadSource.mockReset();
		loadSource.mockRejectedValue(new Error('down'));

		expect((await get('1')).status).toBe(200);
		expect(loadSource).not.toHaveBeenCalled();
	});

	it('502 when no source answers', async () => {
		loadSource.mockRejectedValue(new Error('down'));
		await expect(get('4')).rejects.toMatchObject({ status: 502 });
	});

	it('a slow source does not hold a render slot, so other portraits are served meanwhile', async () => {
		const jpeg = await loadSource();
		let open = () => {};
		const gate = new Promise<void>((resolve) => (open = resolve));
		loadSource.mockImplementation(async (code: string) => {
			if (code !== 'p4') await gate;
			return jpeg;
		});
		for (let id = 200; id <= 203; id++) insertMember(id, `s${id}`, true);

		const waiting = ['200', '201', '202', '203'].map((id) => get(id));
		await vi.waitFor(() => expect(loadSource).toHaveBeenCalledTimes(5));
		const timeout = new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 2_000));
		const served = await Promise.race([get('4').then((r) => r.status), timeout]);
		open();
		await Promise.all(waiting);

		expect(served).toBe(200);
	});

	it('answers 503 with retry-after once more portraits wait than a cold members page needs', async () => {
		const jpeg = await loadSource();
		let open = () => {};
		const gate = new Promise<void>((resolve) => (open = resolve));
		loadSource.mockImplementation(async () => {
			await gate;
			return jpeg;
		});
		for (let id = 100; id <= 604; id++) insertMember(id, `q${id}`, true);

		const requests = Array.from({ length: 505 }, (_, i) => get(String(100 + i)));
		await vi.waitFor(() => expect(loadSource).toHaveBeenCalledTimes(506), { timeout: 10_000 });
		// every download answers at once, so all 505 renders queue before the first one ends
		open();
		const responses = await Promise.all(requests);
		const refused = responses.filter((response) => response.status === 503);

		expect(refused).toHaveLength(1);
		expect(refused[0].headers.get('retry-after')).toBe('2');
		expect(responses.filter((response) => response.status === 200)).toHaveLength(504);
	});
});
