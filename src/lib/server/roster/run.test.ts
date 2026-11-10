import { beforeEach, describe, expect, it } from 'vitest';
import { sql, type Db } from '../db/sqlite';
import { testDb } from '../../../../test/db';
import { importIfStale, importSucceeded } from './run';

const NOW = new Date('2026-11-03T10:00:00Z');

const published = (db: Db, at: string) =>
	db.run(sql`
		insert into roster_import (status, started_at, finished_at, national, states, without_photo)
		values ('published', ${new Date(at)}, ${new Date(at)}, 200, 46, 0)
	`);

const parlDown = {
	fetchSnapshot: async () => {
		throw new Error('ws.parl.ch is down');
	},
	checkPhoto: async () => true
};

describe('importIfStale', () => {
	let db: Db;
	beforeEach(() => {
		db = testDb();
	});

	it('leaves a roster published earlier the same Zurich day alone', async () => {
		// 00:30 in Zurich, still the day before in UTC
		published(db, '2026-11-02T23:30:00Z');

		expect(await importIfStale(db, parlDown, NOW)).toBeNull();
	});

	it('imports when the last roster is from the day before, and throws when that fails', async () => {
		published(db, '2026-11-02T22:30:00Z');

		await expect(importIfStale(db, parlDown, NOW)).rejects.toThrow(/roster import failed/);
	});

	it('imports when no roster was ever published', async () => {
		await expect(importIfStale(db, parlDown, NOW)).rejects.toThrow(/roster import failed/);
	});
});

describe('importSucceeded', () => {
	it('counts a published roster whose portraits failed to refresh as a failure', () => {
		const photos = { unchanged: 240, uploaded: 0, missing: 0, held: 0, failed: 6 };
		expect(importSucceeded({ status: 'published', photos })).toBe(false);
		expect(importSucceeded({ status: 'published', photosError: 'rokka down' })).toBe(false);
		expect(importSucceeded({ status: 'published' })).toBe(true);
		expect(importSucceeded({ status: 'skipped' })).toBe(true);
		expect(importSucceeded({ status: 'rejected' })).toBe(false);
	});
});
