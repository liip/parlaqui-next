import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { sql, type Db } from './sqlite';

const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

type MigrationFile = { name: string; body: string };

function orderOf(name: string): number {
	const match = name.match(/^(\d+)_/);
	if (!match) {
		throw new Error(`Migration file name must start with a number: ${name}`);
	}
	return Number(match[1]);
}

export function parseMigrations(files: MigrationFile[]): MigrationFile[] {
	const ordered = files
		.map((file) => ({ ...file, order: orderOf(file.name) }))
		.sort((a, b) => a.order - b.order);

	const seenNames = new Map<number, string>();
	for (const { name, order } of ordered) {
		const clashingName = seenNames.get(order);
		if (clashingName) {
			throw new Error(`Migrations ${clashingName} and ${name} share the number ${order}`);
		}
		seenNames.set(order, name);
	}

	return ordered.map(({ name, body }) => ({ name, body }));
}

function readMigrationFiles(dir: string): MigrationFile[] {
	return readdirSync(dir)
		.filter((name) => name.endsWith('.sql'))
		.map((name) => ({ name, body: readFileSync(path.join(dir, name), 'utf8') }));
}

// one write transaction for all of them: a second process waits for it, then finds nothing pending.
// Foreign keys are off while they run, so a table rebuilt by copying does not cascade its drop to the
// rows that reference it; they are checked before the commit instead
export function migrate(db: Db, migrationsDir = MIGRATIONS_DIR): string[] {
	const migrations = parseMigrations(readMigrationFiles(migrationsDir));
	db.exec('pragma foreign_keys = off');
	try {
		return applyPending(db, migrations);
	} finally {
		db.exec('pragma foreign_keys = on');
	}
}

function applyPending(db: Db, migrations: MigrationFile[]): string[] {
	return db.tx(() => {
		db.exec(`
			create table if not exists schema_migration (
				name text primary key,
				applied_at integer not null
			) strict
		`);
		const applied = new Set(
			db.all<{ name: string }>(sql`select name from schema_migration`).map((row) => row.name)
		);
		const pending = migrations.filter((migration) => !applied.has(migration.name));
		for (const migration of pending) {
			db.exec(migration.body);
			db.run(
				sql`insert into schema_migration (name, applied_at) values (${migration.name}, ${new Date()})`
			);
		}
		const broken = db.all(sql`pragma foreign_key_check`);
		if (broken.length > 0) {
			throw new Error(`migrations leave ${broken.length} rows with a broken reference`);
		}
		return pending.map((migration) => migration.name);
	});
}
