import { db } from '$lib/server/db';
import { lastPublishedAt, playableMemberCount } from '$lib/server/db/members';
import { asOfDay, isStale } from '$lib/server/roster/freshness';

export const load = async () => {
	const [members, publishedAt] = await Promise.all([playableMemberCount(db), lastPublishedAt(db)]);
	return { members, stale: isStale(publishedAt, new Date()), asOf: asOfDay(publishedAt) };
};
