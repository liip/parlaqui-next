import { db } from '$lib/server/db';
import { migrate } from '$lib/server/db/migrate';
import { onceSucceeded } from '$lib/server/once';

// applied once per server process, at startup; a failed attempt is made again by the next request
export const migration = onceSucceeded(async () => migrate(db));
