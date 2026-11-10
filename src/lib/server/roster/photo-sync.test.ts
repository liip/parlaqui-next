import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql, type Db } from '../db/sqlite';
import { testDb } from '../../../../test/db';
import { syncPhotos } from './photo-sync';

const SHADES: Record<string, string> = { p1: '#884422', p2: '#224488', p4: '#448822' };

const portrait = (shade: string, side = 260) =>
	sharp({ create: { width: side, height: side, channels: 3, background: shade } })
		.jpeg()
		.toBuffer();
const sha1 = (image: Buffer) => createHash('sha1').update(image).digest('hex');
const hashFor = (image: Buffer) => sha1(image).replace(/./, 'f');
const noWait = async () => {};

describe('syncPhotos', () => {
	let db: Db;
	const current: Record<string, Buffer> = {};
	let previous: Buffer;
	let silhouette: Buffer;

	const byCode = async (code: string) => current[code];
	const upload = async (image: Buffer) => hashFor(image);

	const stored = async () =>
		Object.fromEntries(
			db
				.all<{ id: number; photo_hash: string | null; photo_sha1: string | null }>(
					sql`select id, photo_hash, photo_sha1 from member order by id`
				)
				.map((m) => [m.id, { hash: m.photo_hash, sha1: m.photo_sha1 }])
		);

	beforeAll(async () => {
		for (const [code, shade] of Object.entries(SHADES)) current[code] = await portrait(shade);
		previous = await portrait('#111111');
		silhouette = await portrait('#cccccc');
	});

	beforeEach(async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		db = testDb();
		for (const [id, code, active] of [
			[1, 'p1', true],
			[2, 'p2', true],
			[3, null, true],
			[4, 'p4', false]
		] as const) {
			db.run(sql`
				insert into member (id, first_name, last_name, gender, council, canton, party, photo_code, active, updated_at)
				values (${id}, 'F', 'L', 'f', 'N', 'GE', ${JSON.stringify({ de: 'SP' })}, ${code}, ${active}, ${new Date()})
			`);
		}
	});

	const keepPrevious = async () => {
		const kept = { hash: hashFor(previous), sha1: sha1(previous) };
		db.run(sql`update member set photo_hash = ${kept.hash}, photo_sha1 = ${kept.sha1}`);
		return kept;
	};

	it('uploads the portraits of active members and stores hash and sha1', async () => {
		const download = vi.fn(byCode);

		expect(await syncPhotos(db, { download, upload })).toEqual({
			unchanged: 0,
			uploaded: 2,
			missing: 0,
			held: 0,
			failed: 0
		});
		expect(download.mock.calls.map(([code]) => code).sort()).toEqual(['p1', 'p2']);
		const rows = await stored();
		expect(rows[1]).toEqual({ hash: hashFor(current.p1), sha1: sha1(current.p1) });
		expect(rows[3]).toEqual({ hash: null, sha1: null });
		expect(rows[4]).toEqual({ hash: null, sha1: null });
	});

	it('does not upload a portrait that has not changed', async () => {
		for (const [id, code] of [
			[1, 'p1'],
			[2, 'p2']
		] as const) {
			db.run(sql`update member set photo_sha1 = ${sha1(current[code])} where id = ${id}`);
		}
		const spy = vi.fn(upload);

		const outcome = await syncPhotos(db, { download: byCode, upload: spy });

		expect(outcome).toMatchObject({ unchanged: 2, uploaded: 0 });
		expect(spy).not.toHaveBeenCalled();
	});

	it('replaces the copy when parlament.ch has a new portrait', async () => {
		await keepPrevious();

		await syncPhotos(db, { download: byCode, upload });

		expect((await stored())[2]).toEqual({ hash: hashFor(current.p2), sha1: sha1(current.p2) });
	});

	it('counts a portrait parlament.ch no longer has as missing and keeps the copy', async () => {
		const kept = await keepPrevious();

		const outcome = await syncPhotos(db, { download: async () => null, upload });

		expect(outcome).toMatchObject({ missing: 2, failed: 0, uploaded: 0 });
		expect((await stored())[1]).toEqual(kept);
	});

	it('holds back one image served for several members, a placeholder', async () => {
		const kept = await keepPrevious();
		const spy = vi.fn(upload);

		const outcome = await syncPhotos(db, { download: async () => current.p1, upload: spy });

		expect(outcome).toMatchObject({ held: 2, uploaded: 0 });
		expect(spy).not.toHaveBeenCalled();
		expect((await stored())[2]).toEqual(kept);
	});

	it('takes a member with only a placeholder and no copy out of the game, until a portrait comes', async () => {
		const { playableMembers } = await import('../db/members');
		db.run(sql`update member set photo_hash = ${'a'.repeat(40)}, photo_sha1 = 'old' where id = 2`);

		await syncPhotos(db, { download: async () => silhouette, upload, wait: noWait });
		const playable = async () => (await playableMembers(db, 'all')).map((member) => member.id);
		// member 1 has nothing but the placeholder; member 2 keeps its earlier portrait on rokka
		expect(await playable()).toEqual([2]);

		await syncPhotos(db, { download: byCode, upload, wait: noWait });
		expect(await playable()).toEqual([1, 2]);
	});

	it('still knows a placeholder when only one of its members could be downloaded', async () => {
		const { playableMembers } = await import('../db/members');
		await syncPhotos(db, { download: async () => silhouette, upload, wait: noWait });

		// member 2 times out; member 1 alone gets the placeholder file
		const download = async (code: string) => {
			if (code === 'p2') throw new Error('timeout');
			return silhouette;
		};
		const spy = vi.fn(upload);
		const outcome = await syncPhotos(db, { download, upload: spy, wait: noWait });

		expect(outcome).toMatchObject({ held: 1, uploaded: 0, failed: 1 });
		expect(spy).not.toHaveBeenCalled();
		expect((await playableMembers(db, 'all')).map((member) => member.id)).toEqual([]);
	});

	it('keeps the stored copy when the download, the check or the upload fails', async () => {
		const kept = await keepPrevious();
		const tiny = { p1: await portrait('#884422', 40), p2: await portrait('#224488', 40) };
		const garbage = { p1: Buffer.from('<html>1'), p2: Buffer.from('<html>2') };
		const down = async () => {
			throw new Error('rokka down');
		};

		for (const deps of [
			{
				download: async () => {
					throw new Error('timeout');
				},
				upload
			},
			{ download: async (code: string) => garbage[code as 'p1'], upload },
			{ download: async (code: string) => tiny[code as 'p1'], upload },
			{ download: byCode, upload: down, wait: noWait }
		]) {
			expect(await syncPhotos(db, deps)).toMatchObject({ uploaded: 0, failed: 2 });
			expect((await stored())[1]).toEqual(kept);
		}
	});

	it('retries a failed upload once', async () => {
		const flaky = vi
			.fn()
			.mockRejectedValueOnce(new Error('429'))
			.mockImplementation(async (image: Buffer) => hashFor(image));
		const wait = vi.fn(noWait);

		const outcome = await syncPhotos(db, { download: byCode, upload: flaky, wait });

		expect(outcome).toMatchObject({ uploaded: 2, failed: 0 });
		expect(flaky).toHaveBeenCalledTimes(3);
		expect(wait).toHaveBeenCalledWith(2_000);
	});

	it('one failing portrait does not stop the others', async () => {
		const download = async (code: string) => {
			if (code === 'p1') throw new Error('timeout');
			return current[code];
		};
		const outcome = await syncPhotos(db, { download, upload });
		expect(outcome).toMatchObject({ uploaded: 1, failed: 1 });
		expect((await stored())[2].hash).toBe(hashFor(current.p2));
	});
});
