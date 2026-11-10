import { db } from '$lib/server/db';
import { lastPublishedAt } from '$lib/server/db/members';
import { migration } from '$lib/server/db/ready';
import { isOverdue } from '$lib/server/roster/freshness';

const answer = (status: number, body: string) =>
	new Response(body, {
		status,
		headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' }
	});

// for the monitoring, apart from /healthz: a missed import must alert, not take the pod out of service
export const GET = async () => {
	try {
		await migration();
		const published = await lastPublishedAt(db);
		const last = published?.toISOString() ?? 'never';
		return isOverdue(published, new Date())
			? answer(503, `roster import overdue, last published ${last}`)
			: answer(200, `ok, last published ${last}`);
	} catch {
		return answer(503, 'unavailable');
	}
};
