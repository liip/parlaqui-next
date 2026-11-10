import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LANGUAGES } from '$lib/i18n';
import { activeMemberCounts, lastPublishedAt } from '../db/members';
import { sql, type Db } from '../db/sqlite';
import { testDb } from '../../../../test/db';
import { IMPORT_LEASE_MS, LEASE_RENEW_MS, importRoster } from './import';
import type { RawSnapshot } from './types';

const NATIONAL_FIRST_ID = 1000;
const STATES_FIRST_ID = 2000;
const COUNCIL_KEYS = { N: '1311000', S: '1311001' };

function record(id: number, council: 'N' | 'S', party: string) {
	return {
		id,
		legacyId: id + 50000,
		firstName: `First${id}`,
		lastName: `Last${id}`,
		type: { key: '1731013' },
		gender: { key: id % 2 ? '1621001' : '1621002' },
		council: { key: COUNCIL_KEYS[council] },
		canton: { abbreviation: 'VD' },
		party: { shortName: party, name: party }
	};
}

type Spec = { id: number; council: 'N' | 'S'; party?: string };

function snapshotOf(specs: Spec[]): RawSnapshot {
	const records = specs.map(({ id, council, party }) => record(id, council, party ?? 'SP'));
	return Object.fromEntries(LANGUAGES.map((lang) => [lang, records])) as RawSnapshot;
}

function specs(national = 198, states = 45): Spec[] {
	return [
		...Array.from({ length: national }, (_, i) => ({
			id: NATIONAL_FIRST_ID + i,
			council: 'N' as const
		})),
		...Array.from({ length: states }, (_, i) => ({
			id: STATES_FIRST_ID + i,
			council: 'S' as const
		}))
	];
}

const photoOk = async () => true;

const photoCodes = (db: Db) =>
	db.all<{ id: number; photo_code: string | null }>(
		sql`select id, photo_code from member order by id`
	);

const lastImport = (db: Db) =>
	db.get<{ status: string; detail: string | null }>(
		sql`select status, detail from roster_import order by id desc limit 1`
	)!;

describe('importRoster', () => {
	let db: Db;

	beforeEach(() => {
		db = testDb();
	});

	it('publishes a valid snapshot', async () => {
		const outcome = await importRoster(db, {
			fetchSnapshot: async () => snapshotOf(specs()),
			checkPhoto: photoOk
		});

		expect(outcome).toMatchObject({
			status: 'published',
			national: 198,
			states: 45,
			withoutPhoto: 0,
			detail: 'de records 243, parsed 243'
		});
		expect(await activeMemberCounts(db)).toEqual({ national: 198, states: 45 });
		const imports = db.all<{ status: string }>(sql`select status, finished_at from roster_import`);
		expect(imports).toHaveLength(1);
		expect(imports[0].status).toBe('published');
		expect(await lastPublishedAt(db)).toBeInstanceOf(Date);
	});

	it('deactivates a member who left, and keeps the row', async () => {
		const deps = { checkPhoto: photoOk };
		await importRoster(db, { ...deps, fetchSnapshot: async () => snapshotOf(specs()) });

		const without = specs().filter((spec) => spec.id !== NATIONAL_FIRST_ID);
		await importRoster(db, { ...deps, fetchSnapshot: async () => snapshotOf(without) });

		const left = db.get<{ active: number }>(
			sql`select active from member where id = ${NATIONAL_FIRST_ID}`
		)!;
		expect(left.active).toBe(0);
		expect(await activeMemberCounts(db)).toEqual({ national: 197, states: 45 });
	});

	it('updates a member who changes council or party in place', async () => {
		const deps = { checkPhoto: photoOk };
		await importRoster(db, { ...deps, fetchSnapshot: async () => snapshotOf(specs()) });

		const changed = specs().map((spec) =>
			spec.id === NATIONAL_FIRST_ID ? { ...spec, council: 'S' as const, party: 'Mitte' } : spec
		);
		await importRoster(db, { ...deps, fetchSnapshot: async () => snapshotOf(changed) });

		const rows = db.all<{ council: string; active: number; party: string }>(
			sql`select council, active, party from member where id = ${NATIONAL_FIRST_ID}`
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].council).toBe('S');
		expect(rows[0].active).toBe(1);
		expect(JSON.parse(rows[0].party).de).toBe('Mitte');
	});

	it('keeps the roster when the fetch fails', async () => {
		await importRoster(db, {
			checkPhoto: photoOk,
			fetchSnapshot: async () => snapshotOf(specs())
		});

		const outcome = await importRoster(db, {
			checkPhoto: photoOk,
			fetchSnapshot: async () => {
				throw new Error('ws.parl.ch unreachable');
			}
		});

		expect(outcome).toEqual({ status: 'failed', detail: 'ws.parl.ch unreachable' });
		expect(await activeMemberCounts(db)).toEqual({ national: 198, states: 45 });
		expect(lastImport(db)).toEqual({ status: 'failed', detail: 'ws.parl.ch unreachable' });
	});

	it('keeps the roster when validation fails', async () => {
		await importRoster(db, {
			checkPhoto: photoOk,
			fetchSnapshot: async () => snapshotOf(specs())
		});

		const outcome = await importRoster(db, {
			checkPhoto: photoOk,
			fetchSnapshot: async () => snapshotOf(specs(150, 45))
		});

		expect(outcome.status).toBe('rejected');
		expect(outcome.detail).toContain('Nationalrat has 150 members');
		expect(await activeMemberCounts(db)).toEqual({ national: 198, states: 45 });
		expect(lastImport(db).status).toBe('rejected');
	});

	it('stores no photo code when the photo check fails', async () => {
		const missing = String(NATIONAL_FIRST_ID + 50000);

		const outcome = await importRoster(db, {
			fetchSnapshot: async () => snapshotOf(specs()),
			checkPhoto: async (code) => code !== missing
		});

		expect(outcome.status).toBe('published');
		expect(outcome.withoutPhoto).toBe(1);
		const [row, other] = photoCodes(db);
		expect(row.photo_code).toBeNull();
		expect(other.photo_code).toBe(String(NATIONAL_FIRST_ID + 1 + 50000));
	});

	it('keeps the photo code of a member whose portrait is still on rokka', async () => {
		const deps = { fetchSnapshot: async () => snapshotOf(specs()) };
		await importRoster(db, { ...deps, checkPhoto: photoOk });
		const code = String(NATIONAL_FIRST_ID + 50000);
		db.run(sql`update member set photo_hash = ${'a'.repeat(40)} where id = ${NATIONAL_FIRST_ID}`);

		const outcome = await importRoster(db, {
			...deps,
			checkPhoto: async (checked) =>
				checked !== code && checked !== String(NATIONAL_FIRST_ID + 50001)
		});

		expect(outcome.withoutPhoto).toBe(1);
		const rows = photoCodes(db).slice(0, 2);
		expect(rows.map((row) => row.photo_code)).toEqual([code, null]);
	});

	it('syncs the photos under the lease after a publish and records the counts', async () => {
		let concurrent: Awaited<ReturnType<typeof importRoster>> | undefined;
		const photos = { unchanged: 240, uploaded: 2, missing: 1, held: 0, failed: 0 };

		const outcome = await importRoster(db, {
			fetchSnapshot: async () => snapshotOf(specs()),
			checkPhoto: photoOk,
			syncPhotos: async () => {
				concurrent = await importRoster(db, {
					fetchSnapshot: async () => snapshotOf(specs()),
					checkPhoto: photoOk
				});
				return photos;
			}
		});

		expect(concurrent).toEqual({ status: 'skipped' });
		expect(outcome).toMatchObject({ status: 'published', photos });
		const row = lastImport(db);
		expect(row.status).toBe('published');
		expect(row.detail).toBe(
			'de records 243, parsed 243; photos unchanged 240, uploaded 2, missing 1, held 0, failed 0'
		);
	});

	it('keeps the published roster when the photo sync throws, and says so', async () => {
		const outcome = await importRoster(db, {
			fetchSnapshot: async () => snapshotOf(specs()),
			checkPhoto: photoOk,
			syncPhotos: async () => {
				throw new Error('database gone');
			}
		});

		expect(outcome).toMatchObject({ status: 'published', photosError: 'database gone' });
		expect(await activeMemberCounts(db)).toEqual({ national: 198, states: 45 });
	});

	it('does not sync photos when the snapshot is rejected', async () => {
		let synced = false;
		await importRoster(db, {
			fetchSnapshot: async () => snapshotOf(specs(10, 2)),
			checkPhoto: photoOk,
			syncPhotos: async () => {
				synced = true;
				return { unchanged: 0, uploaded: 0, missing: 0, held: 0, failed: 0 };
			}
		});
		expect(synced).toBe(false);
	});

	it('skips while another import is running, and leaves it alone', async () => {
		let release = () => {};
		const fetched = new Promise<RawSnapshot>((resolve) => {
			release = () => resolve(snapshotOf(specs()));
		});
		const first = importRoster(db, { checkPhoto: photoOk, fetchSnapshot: () => fetched });

		const second = await importRoster(db, {
			fetchSnapshot: async () => snapshotOf(specs()),
			checkPhoto: photoOk
		});
		release();

		expect(second).toEqual({ status: 'skipped' });
		expect(await first).toMatchObject({ status: 'published' });
		expect(db.all(sql`select status from roster_import`)).toEqual([{ status: 'published' }]);
	});

	it('skips while another process holds the lease', async () => {
		const leaseUntil = new Date(Date.now() + 60_000);
		db.run(sql`
			insert into roster_import (status, started_at, lease_until)
			values ('running', ${new Date()}, ${leaseUntil})
		`);

		const outcome = await importRoster(db, {
			fetchSnapshot: async () => snapshotOf(specs()),
			checkPhoto: photoOk
		});

		expect(outcome).toEqual({ status: 'skipped' });
		expect(db.all(sql`select status, detail from roster_import`)).toEqual([
			{ status: 'running', detail: null }
		]);
	});

	async function expectLeaseFree() {
		const outcome = await importRoster(db, {
			fetchSnapshot: async () => {
				throw new Error('probe');
			},
			checkPhoto: photoOk
		});
		expect(outcome.status).toBe('failed');
	}

	it('releases the lease after a published, a rejected and a failed import', async () => {
		const checkPhoto = photoOk;

		await importRoster(db, { checkPhoto, fetchSnapshot: async () => snapshotOf(specs()) });
		await expectLeaseFree();
		await importRoster(db, { checkPhoto, fetchSnapshot: async () => snapshotOf(specs(150, 45)) });
		await expectLeaseFree();
		await importRoster(db, {
			checkPhoto,
			fetchSnapshot: async () => {
				throw new Error('boom');
			}
		});
		await expectLeaseFree();
	});

	it('keeps stored photo codes when the photo check throws', async () => {
		await importRoster(db, {
			checkPhoto: photoOk,
			fetchSnapshot: async () => snapshotOf(specs())
		});
		const before = photoCodes(db);

		const outcome = await importRoster(db, {
			fetchSnapshot: async () => snapshotOf(specs()),
			checkPhoto: async () => {
				throw new Error('photo service down');
			}
		});

		expect(outcome.status).toBe('published');
		expect(outcome.detail).toContain('photo checks failed 243, kept stored codes');
		expect(photoCodes(db)).toEqual(before);
		expect(before[0].photo_code).not.toBeNull();
	});

	it('rejects when the photo check says no photo for most members who had one', async () => {
		await importRoster(db, {
			checkPhoto: photoOk,
			fetchSnapshot: async () => snapshotOf(specs())
		});
		const before = photoCodes(db);

		const outcome = await importRoster(db, {
			fetchSnapshot: async () => snapshotOf(specs()),
			checkPhoto: async () => false
		});

		expect(outcome.status).toBe('rejected');
		expect(outcome.detail).toBe(
			'photo check says no photo for 243 members who had one; refusing to remove them'
		);
		expect(photoCodes(db)).toEqual(before);
		expect(lastImport(db).status).toBe('rejected');
	});

	it('rejects a snapshot without any photo code after a good import, keeping every code', async () => {
		await importRoster(db, {
			checkPhoto: photoOk,
			fetchSnapshot: async () => snapshotOf(specs())
		});
		const before = photoCodes(db);
		const uncoded = Object.fromEntries(
			LANGUAGES.map((lang) => [
				lang,
				snapshotOf(specs())[lang].map((raw) => ({ ...(raw as object), legacyId: undefined }))
			])
		) as RawSnapshot;

		const outcome = await importRoster(db, {
			fetchSnapshot: async () => uncoded,
			checkPhoto: photoOk
		});

		expect(outcome.status).toBe('rejected');
		expect(outcome.detail).toBe(
			'ws.parl.ch sends no photo code for 243 members who had one; refusing to remove them'
		);
		expect(photoCodes(db)).toEqual(before);
		expect(before.every((row) => row.photo_code !== null)).toBe(true);
	});

	it('keeps the stored code of a member who loses the legacyId but is still on rokka', async () => {
		await importRoster(db, {
			checkPhoto: photoOk,
			fetchSnapshot: async () => snapshotOf(specs())
		});
		const kept = NATIONAL_FIRST_ID;
		const cleared = NATIONAL_FIRST_ID + 1;
		db.run(sql`update member set photo_hash = ${'a'.repeat(40)} where id = ${kept}`);
		const snapshot = snapshotOf(specs());
		for (const lang of LANGUAGES) {
			snapshot[lang] = snapshot[lang].map((raw) => {
				const record = raw as { id: number; legacyId?: number };
				return record.id === kept || record.id === cleared
					? { ...record, legacyId: undefined }
					: record;
			});
		}

		const outcome = await importRoster(db, {
			fetchSnapshot: async () => snapshot,
			checkPhoto: photoOk
		});

		expect(outcome).toMatchObject({ status: 'published', withoutPhoto: 1 });
		const rows = db.all<{ photo_code: string | null }>(
			sql`select photo_code from member where id in (${kept}, ${cleared}) order by id`
		);
		expect(rows.map((row) => row.photo_code)).toEqual([String(kept + 50000), null]);
	});

	it('names both causes when photo checks and missing codes together lose too many photos', async () => {
		await importRoster(db, {
			checkPhoto: photoOk,
			fetchSnapshot: async () => snapshotOf(specs())
		});
		const snapshot = snapshotOf(specs());
		snapshot.de = snapshot.de.map((raw, i) =>
			i < 7 ? { ...(raw as object), legacyId: null } : raw
		);
		const refused = specs()
			.slice(7, 14)
			.map(({ id }) => String(id + 50000));

		const outcome = await importRoster(db, {
			fetchSnapshot: async () => snapshot,
			checkPhoto: async (code) => !refused.includes(code)
		});

		expect(outcome.detail).toBe(
			'photo check says no photo for 7 and ws.parl.ch sends no photo code for 7 members who had one; refusing to remove them'
		);
	});

	it('rejects a snapshot whose pages repeat a member, keeping the roster', async () => {
		await importRoster(db, {
			checkPhoto: photoOk,
			fetchSnapshot: async () => snapshotOf(specs())
		});
		const snapshot = snapshotOf(specs());
		snapshot.it = [...snapshot.it, snapshot.it[0]];

		const outcome = await importRoster(db, {
			fetchSnapshot: async () => snapshot,
			checkPhoto: photoOk
		});

		expect(outcome).toEqual({
			status: 'rejected',
			detail: `it records repeat ids ${NATIONAL_FIRST_ID}`
		});
		expect(await activeMemberCounts(db)).toEqual({ national: 198, states: 45 });
	});

	it('rejects a snapshot with a malformed council member instead of retiring them', async () => {
		await importRoster(db, {
			checkPhoto: photoOk,
			fetchSnapshot: async () => snapshotOf(specs())
		});
		const snapshot = snapshotOf(specs());
		snapshot.de = snapshot.de.map((raw) => {
			const record = raw as { id: number };
			return record.id === STATES_FIRST_ID ? { ...record, gender: null } : record;
		});

		const outcome = await importRoster(db, {
			fetchSnapshot: async () => snapshot,
			checkPhoto: photoOk
		});

		expect(outcome).toEqual({
			status: 'rejected',
			detail: `1 incomplete council member records: ${STATES_FIRST_ID}`
		});
		const row = db.get<{ active: number }>(
			sql`select active from member where id = ${STATES_FIRST_ID}`
		)!;
		expect(row.active).toBe(1);
	});

	it('publishes and counts a member record without a known council', async () => {
		const snapshot = snapshotOf(specs());
		snapshot.de = snapshot.de.map((raw) => {
			const record = raw as { id: number };
			return record.id === NATIONAL_FIRST_ID ? { ...record, council: null } : record;
		});

		const outcome = await importRoster(db, {
			fetchSnapshot: async () => snapshot,
			checkPhoto: photoOk
		});

		expect(outcome).toMatchObject({
			status: 'published',
			detail: 'de records 243, parsed 242, incomplete 1'
		});
	});

	it('publishes and nulls the codes when only a few members lose their photo', async () => {
		await importRoster(db, {
			checkPhoto: photoOk,
			fetchSnapshot: async () => snapshotOf(specs())
		});
		const lost = [1, 2, 3].map((n) => String(NATIONAL_FIRST_ID + n + 50000));

		const outcome = await importRoster(db, {
			fetchSnapshot: async () => snapshotOf(specs()),
			checkPhoto: async (code) => !lost.includes(code)
		});

		expect(outcome.status).toBe('published');
		const row = db.get<{ nulled: number }>(
			sql`select count(*) as nulled from member where photo_code is null`
		)!;
		expect(row.nulled).toBe(3);
	});

	it('gives a new member no photo code when the photo check throws', async () => {
		const outcome = await importRoster(db, {
			fetchSnapshot: async () => snapshotOf(specs()),
			checkPhoto: async () => {
				throw new Error('photo service down');
			}
		});

		expect(outcome.status).toBe('published');
		const row = db.get<{ coded: number }>(sql`select count(photo_code) as coded from member`)!;
		expect(row.coded).toBe(0);
	});

	it('rolls back everything when the publish transaction fails', async () => {
		await importRoster(db, {
			checkPhoto: photoOk,
			fetchSnapshot: async () => snapshotOf(specs())
		});
		const members = sql`select id, active, council, updated_at from member order by id`;
		const before = db.all(members);

		// passes parsing and validation, but overflows the 64-bit integer id column during the upsert
		const faulty = [...specs().slice(1), { id: 1e20, council: 'N' as const }];
		const outcome = await importRoster(db, {
			checkPhoto: photoOk,
			fetchSnapshot: async () => snapshotOf(faulty)
		});

		expect(outcome.status).toBe('failed');
		expect(db.all(members)).toEqual(before);
		expect(lastImport(db).status).toBe('failed');
	});

	it('marks a running import whose lease ran out as interrupted, and proceeds', async () => {
		const leaseUntil = new Date(Date.now() - 1);
		db.run(sql`
			insert into roster_import (status, started_at, lease_until)
			values ('running', ${new Date(Date.now() - IMPORT_LEASE_MS)}, ${leaseUntil})
		`);

		const outcome = await importRoster(db, {
			checkPhoto: photoOk,
			fetchSnapshot: async () => snapshotOf(specs())
		});

		expect(outcome.status).toBe('published');
		const rows = db.all<{ status: string; detail: string | null; finished_at: number | null }>(
			sql`select status, detail, finished_at from roster_import order by id`
		);
		expect(rows[0].status).toBe('failed');
		expect(rows[0].detail).toBe('interrupted');
		expect(rows[0].finished_at).not.toBeNull();
		expect(rows[1].status).toBe('published');
	});

	it('an import that outlived its lease leaves the newer roster alone', async () => {
		let release = () => {};
		const fetched = new Promise<RawSnapshot>((resolve) => {
			release = () => resolve(snapshotOf(specs().map((spec) => ({ ...spec, party: 'OLD' }))));
		});
		const expired = importRoster(db, { checkPhoto: photoOk, fetchSnapshot: () => fetched });
		db.run(sql`update roster_import set lease_until = ${new Date(Date.now() - 1)}`);

		const newer = await importRoster(db, {
			checkPhoto: photoOk,
			fetchSnapshot: async () => snapshotOf(specs().map((spec) => ({ ...spec, party: 'NEW' })))
		});
		release();

		expect(newer.status).toBe('published');
		expect(await expired).toEqual({ status: 'failed', detail: 'lease lost to a newer import' });
		const parties = db.all<{ party: string }>(sql`select distinct party from member`);
		expect(parties.map((row) => JSON.parse(row.party).de)).toEqual(['NEW']);
		expect(db.all(sql`select status, detail from roster_import order by id`)).toMatchObject([
			{ status: 'failed', detail: 'interrupted' },
			{ status: 'published' }
		]);
	});

	it('keeps the roster of an import that died during its photo sync as published', async () => {
		const publishedAt = new Date(Date.now() - IMPORT_LEASE_MS);
		db.run(sql`
			insert into roster_import
				(status, started_at, finished_at, lease_until, national, states, without_photo, detail)
			values ('running', ${publishedAt}, ${publishedAt}, ${new Date(Date.now() - 1)}, 198, 45, 0, 'parsed 243')
		`);

		await expectLeaseFree();

		expect(db.all(sql`select status, finished_at, detail from roster_import order by id`)).toEqual([
			{
				status: 'published',
				finished_at: publishedAt.getTime(),
				detail: 'parsed 243; photos interrupted'
			},
			{ status: 'failed', finished_at: expect.any(Number), detail: 'probe' }
		]);
		expect(await lastPublishedAt(db)).toEqual(publishedAt);
	});

	it('dates the roster from its publish while the photo sync still runs', async () => {
		let finishSync = () => {};
		const imported = importRoster(db, {
			checkPhoto: photoOk,
			fetchSnapshot: async () => snapshotOf(specs()),
			syncPhotos: () =>
				new Promise((resolve) => {
					finishSync = () => resolve({ unchanged: 0, uploaded: 0, missing: 0, held: 0, failed: 0 });
				})
		});
		await vi.waitFor(() => expect(lastImport(db).status).toBe('running'));
		await vi.waitFor(async () => expect(await lastPublishedAt(db)).not.toBeNull());

		finishSync();
		expect((await imported).status).toBe('published');
	});

	describe('a long import', () => {
		beforeEach(() => {
			vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
		});
		afterEach(() => vi.useRealTimers());

		it('renews its lease, so a second import is skipped however long the first runs', async () => {
			let release = () => {};
			const fetched = new Promise<RawSnapshot>((resolve) => {
				release = () => resolve(snapshotOf(specs()));
			});
			const first = importRoster(db, { checkPhoto: photoOk, fetchSnapshot: () => fetched });

			vi.advanceTimersByTime(IMPORT_LEASE_MS * 5);
			const second = await importRoster(db, {
				checkPhoto: photoOk,
				fetchSnapshot: async () => snapshotOf(specs())
			});
			release();

			expect(second).toEqual({ status: 'skipped' });
			expect((await first).status).toBe('published');
		});

		it('logs a failed renewal and goes on, instead of ending the process', async () => {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			let release = () => {};
			const fetched = new Promise<RawSnapshot>((resolve) => {
				release = () => resolve(snapshotOf(specs()));
			});
			const imported = importRoster(db, { checkPhoto: photoOk, fetchSnapshot: () => fetched });
			vi.spyOn(db, 'run').mockImplementationOnce(() => {
				throw new Error('database or disk is full');
			});

			vi.advanceTimersByTime(LEASE_RENEW_MS);
			release();

			expect(warn).toHaveBeenCalledWith(expect.stringContaining('database or disk is full'));
			expect((await imported).status).toBe('published');
		});

		it('stops renewing once done, so a dead lease runs out', async () => {
			await importRoster(db, {
				checkPhoto: photoOk,
				fetchSnapshot: async () => snapshotOf(specs())
			});
			const { lease_until: before } = db.get<{ lease_until: number }>(
				sql`select lease_until from roster_import`
			)!;

			vi.advanceTimersByTime(IMPORT_LEASE_MS * 5);

			expect(db.get(sql`select lease_until from roster_import`)).toEqual({ lease_until: before });
		});
	});
});
