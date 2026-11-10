import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { Db } from './sqlite';

const DATABASE_PATH = env.DATABASE_PATH || 'data/parlaqui.db';

mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });

export const db = new Db(DATABASE_PATH);

// a database in memory has nothing to keep
export const BACKUP_PATH =
	DATABASE_PATH === ':memory:' ? null : path.join(path.dirname(DATABASE_PATH), 'backup.db');
