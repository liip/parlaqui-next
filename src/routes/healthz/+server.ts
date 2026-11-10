import { db } from '$lib/server/db';
import { migration } from '$lib/server/db/ready';
import { sql } from '$lib/server/db/sqlite';

const answer = (status: number, body: string) =>
	new Response(body, {
		status,
		headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' }
	});

// the container is healthy only once the schema is in place and the database answers
export const GET = async () => {
	try {
		await migration();
		db.get(sql`select 1`);
		return answer(200, 'ok');
	} catch {
		return answer(503, 'unavailable');
	}
};
