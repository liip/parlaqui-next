import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { migrate, parseMigrations } from './migrate';
import { Db, sql } from './sqlite';

describe('parseMigrations', () => {
	it('sorts by numeric order, not lexicographic order', () => {
		// different digit widths: a plain string .sort() would put '10_second.sql' first
		const files = [
			{ name: '10_second.sql', body: '' },
			{ name: '2_first.sql', body: '' }
		];

		expect(parseMigrations(files).map((file) => file.name)).toEqual([
			'2_first.sql',
			'10_second.sql'
		]);
	});

	it('rejects a name without a numeric prefix', () => {
		expect(() => parseMigrations([{ name: 'init.sql', body: '' }])).toThrow();
	});

	it('rejects two files with the same number', () => {
		const files = [
			{ name: '001_a.sql', body: '' },
			{ name: '001_b.sql', body: '' }
		];

		expect(() => parseMigrations(files)).toThrow();
	});
});

describe('migrate', () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'pq-migrate-'));
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	it('applies the schema then replays nothing', () => {
		const db = new Db(':memory:');
		expect(migrate(db)).toEqual(['001_schema.sql']);
		expect(migrate(db)).toEqual([]);

		const tables = db
			.all<{ name: string }>(sql`select name from sqlite_schema where type = 'table' order by name`)
			.map((row) => row.name);
		expect(tables).toEqual([
			'game',
			'game_round',
			'games_started_day',
			'member',
			'page_view',
			'photo_placeholder',
			'roster_import',
			'schema_migration',
			'visitor',
			'visitor_day'
		]);
	});

	it('a failing migration leaves nothing behind, and the next run applies the fixed one', () => {
		const db = new Db(':memory:');
		writeFileSync(path.join(dir, '001_a.sql'), 'create table a (n integer);');
		writeFileSync(
			path.join(dir, '002_b.sql'),
			'create table b (n integer); select * from missing;'
		);

		expect(() => migrate(db, dir)).toThrow(/missing/);
		expect(
			db.all(sql`select name from sqlite_schema where name in ('a', 'b', 'schema_migration')`)
		).toEqual([]);

		writeFileSync(path.join(dir, '002_b.sql'), 'create table b (n integer);');
		expect(migrate(db, dir)).toEqual(['001_a.sql', '002_b.sql']);
	});

	it('a table rebuilt by copying keeps the rows that reference it', () => {
		const db = new Db(':memory:');
		writeFileSync(path.join(dir, '001_a.sql'), 'create table a (id integer primary key);');
		writeFileSync(
			path.join(dir, '002_b.sql'),
			'create table b (a_id integer references a(id) on delete cascade); insert into a values (1); insert into b values (1);'
		);
		writeFileSync(
			path.join(dir, '003_rebuild.sql'),
			'create table a_new (id integer primary key, note text); insert into a_new (id) select id from a; drop table a; alter table a_new rename to a;'
		);

		migrate(db, dir);

		expect(db.all(sql`select a_id from b`)).toEqual([{ a_id: 1 }]);
		expect(db.get(sql`pragma foreign_keys`)).toEqual({ foreign_keys: 1 });
		rmSync(path.join(dir, '002_b.sql'));
		rmSync(path.join(dir, '003_rebuild.sql'));
	});

	it('rolls back migrations that leave a broken reference', () => {
		const db = new Db(':memory:');
		writeFileSync(path.join(dir, '001_a.sql'), 'create table a (id integer primary key);');
		writeFileSync(
			path.join(dir, '002_b.sql'),
			'create table b (a_id integer references a(id)); insert into b values (7);'
		);

		expect(() => migrate(db, dir)).toThrow(/broken reference/);
		expect(db.all(sql`select name from sqlite_schema where name in ('a', 'b')`)).toEqual([]);
		rmSync(path.join(dir, '002_b.sql'));
	});

	it('two processes on one file apply each migration once', () => {
		const file = path.join(dir, 'shared.db');
		const first = new Db(file);
		const second = new Db(file);

		expect(migrate(first)).toEqual(['001_schema.sql']);
		expect(migrate(second)).toEqual([]);
		first.close();
		second.close();
	});
});
