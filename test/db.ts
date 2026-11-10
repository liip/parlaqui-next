import { migrate } from '../src/lib/server/db/migrate';
import { Db } from '../src/lib/server/db/sqlite';

// a private in-memory database with the schema applied; nothing outlives the test file
export function testDb(): Db {
	const db = new Db(':memory:');
	migrate(db);
	return db;
}
