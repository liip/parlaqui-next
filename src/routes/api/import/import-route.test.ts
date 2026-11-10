import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LANGUAGES } from '$lib/i18n';
import type { RawSnapshot } from '$lib/server/roster/types';

const TOKEN = 'i7Kq2Ls9Nx4Rt8Yb3Wm6Zc1Pd5Hg0Jf2Sn7Vr4';
const COUNCIL_KEYS = { N: '1311000', S: '1311001' };

// the route reads the shared db instance, so this file points it at its own database before importing it
process.env.DATABASE_PATH = ':memory:';
process.env.IMPORT_TOKEN = TOKEN;
process.env.PARL_API_KEY = 'test-key';

const parl = vi.hoisted(() => ({ fetchSnapshot: vi.fn() }));
vi.mock('$lib/server/roster/parl-client', () => parl);
vi.mock('$lib/server/roster/photos', () => ({ checkPhoto: async () => true }));

const { db } = await import('$lib/server/db');
const { migrate } = await import('$lib/server/db/migrate');
const { sql } = await import('$lib/server/db/sqlite');
const { POST: run } = await import('./+server');

function snapshotOf(national: number, states: number): RawSnapshot {
	const records = [
		...Array.from({ length: national }, (_, i) => ({ id: 1000 + i, council: 'N' as const })),
		...Array.from({ length: states }, (_, i) => ({ id: 2000 + i, council: 'S' as const }))
	].map(({ id, council }) => ({
		id,
		legacyId: id + 50000,
		firstName: `First${id}`,
		lastName: `Last${id}`,
		type: { key: '1731013' },
		gender: { key: id % 2 ? '1621001' : '1621002' },
		council: { key: COUNCIL_KEYS[council] },
		canton: { abbreviation: 'VD' },
		party: { shortName: 'SP', name: 'SP' }
	}));
	return Object.fromEntries(LANGUAGES.map((lang) => [lang, records])) as RawSnapshot;
}

function call(token: string | null = TOKEN) {
	const headers: Record<string, string> = {};
	if (token !== null) headers.authorization = `Bearer ${token}`;
	return run({
		request: new Request('http://localhost/api/import', { method: 'POST', headers })
	} as unknown as Parameters<typeof run>[0]);
}

beforeAll(() => {
	migrate(db);
});

beforeEach(() => {
	db.exec('delete from member; delete from roster_import');
	parl.fetchSnapshot.mockResolvedValue(snapshotOf(198, 45));
});

afterEach(() => {
	process.env.IMPORT_TOKEN = TOKEN;
	process.env.PARL_API_KEY = 'test-key';
});

describe('POST /api/import', () => {
	it('answers 404 without the token', async () => {
		await expect(call(null)).rejects.toMatchObject({ status: 404 });
	});

	it('answers 404 with a wrong token', async () => {
		await expect(call('x'.repeat(TOKEN.length))).rejects.toMatchObject({ status: 404 });
	});

	it('answers 500 naming the variable when PARL_API_KEY is unset', async () => {
		delete process.env.PARL_API_KEY;
		const failure = await call().catch((cause) => cause);
		expect(failure.status).toBe(500);
		expect(failure.body.message).toContain('PARL_API_KEY');
	});

	it('answers 200 with the outcome when published', async () => {
		const response = await call();
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ status: 'published', national: 198, states: 45 });
		expect(parl.fetchSnapshot).toHaveBeenCalledWith('test-key');
	});

	it('answers 200 skipped while another import holds the lease', async () => {
		const leaseUntil = new Date(Date.now() + 60_000);
		db.run(sql`
			insert into roster_import (status, started_at, lease_until)
			values ('running', ${new Date()}, ${leaseUntil})
		`);

		const response = await call();
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'skipped' });
	});

	it('answers 502 when the snapshot is rejected', async () => {
		parl.fetchSnapshot.mockResolvedValue(snapshotOf(3, 2));
		const response = await call();
		expect(response.status).toBe(502);
		expect(await response.json()).toMatchObject({ status: 'rejected' });
	});

	it('answers 502 when the fetch fails', async () => {
		parl.fetchSnapshot.mockRejectedValue(new Error('ws.parl.ch down'));
		const response = await call();
		expect(response.status).toBe(502);
		expect(await response.json()).toMatchObject({ status: 'failed' });
	});
});
