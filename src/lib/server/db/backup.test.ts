import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { snapshot } from './backup';
import { Db, sql } from './sqlite';

describe('snapshot', () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'pq-backup-'));
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	it('copies what is still only in the write-ahead log, and replaces the previous copy', async () => {
		const db = new Db(path.join(dir, 'live.db'));
		db.exec('create table t (n integer)');
		db.run(sql`insert into t values (${1})`);
		const target = path.join(dir, 'backup.db');

		await snapshot(db, target);
		db.run(sql`insert into t values (${2})`);
		await snapshot(db, target);
		db.close();

		const restored = new Db(target);
		expect(restored.all(sql`select n from t order by n`)).toEqual([{ n: 1 }, { n: 2 }]);
		restored.close();
		expect(existsSync(`${target}.partial`)).toBe(false);
	});
});
