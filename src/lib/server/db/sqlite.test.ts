import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Db, list, sql, toBool, toDate } from './sqlite';

describe('sql', () => {
	it('turns values into parameters and splices nested queries', () => {
		const inner = sql`b = ${2}`;
		const query = sql`select 1 where a = ${1} and ${inner} and c in ${list(['x', 'y'])}`;
		expect(query.text).toBe('select 1 where a = ? and b = ? and c in (?, ?)');
		expect(query.params).toEqual([1, 2, 'x', 'y']);
	});

	it('stores dates as milliseconds, booleans as 0 or 1 and undefined as null', () => {
		const at = new Date('2026-11-30T08:00:00Z');
		expect(sql`${at} ${true} ${false} ${undefined}`.params).toEqual([at.getTime(), 1, 0, null]);
	});

	it('reads them back', () => {
		expect(toDate(1_000)).toEqual(new Date(1_000));
		expect(toDate(null)).toBeNull();
		expect(toBool(1)).toBe(true);
		expect(toBool(0)).toBe(false);
		expect(toBool(null)).toBeNull();
	});
});

describe('Db', () => {
	const db = new Db(':memory:');
	db.exec('create table t (id integer primary key, n integer not null) strict');

	it('rolls a failing transaction back whole', () => {
		expect(() =>
			db.tx(() => {
				db.run(sql`insert into t (n) values (${1})`);
				throw new Error('boom');
			})
		).toThrow('boom');
		expect(db.get(sql`select count(*) as count from t`)).toEqual({ count: 0 });
	});

	it('matches nothing with an empty list', () => {
		db.run(sql`insert into t (n) values (${1})`);
		expect(db.all(sql`select n from t where n in ${list([])}`)).toEqual([]);
	});

	it('counts the rows a statement changed', () => {
		expect(db.run(sql`update t set n = n + 1`)).toBe(1);
	});

	it('knows the Zurich day of a time in milliseconds', () => {
		const at = new Date('2026-11-30T23:30:00Z');
		expect(db.get(sql`select zurich_day(${at}) as day`)).toEqual({ day: '2026-12-01' });
	});

	describe('on a file', () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), 'pq-sqlite-'));
		const file = path.join(dir, 'test.db');
		afterAll(() => rmSync(dir, { recursive: true, force: true }));

		it('writes ahead in a log and enforces foreign keys', () => {
			const onFile = new Db(file);
			expect(onFile.raw.pragma('journal_mode', { simple: true })).toBe('wal');
			expect(onFile.raw.pragma('foreign_keys', { simple: true })).toBe(1);
			onFile.close();
		});

		it('a second connection sees what the first committed', () => {
			const first = new Db(file);
			const second = new Db(file);
			first.exec('create table u (n integer) strict');
			first.run(sql`insert into u values (${7})`);
			expect(second.get(sql`select n from u`)).toEqual({ n: 7 });
			first.close();
			second.close();
		});
	});
});
