import { renameSync, rmSync } from 'node:fs';
import type { Db } from './sqlite';

// a copy taken by SQLite itself, page by page between requests; written aside then renamed, so a
// backup of the volume never picks up a half-written file
export async function snapshot(db: Db, target: string): Promise<void> {
	const partial = `${target}.partial`;
	rmSync(partial, { force: true });
	await db.raw.backup(partial);
	renameSync(partial, target);
}
