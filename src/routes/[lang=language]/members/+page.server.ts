import { groupRoster } from '$lib/cantons';
import { isLanguage } from '$lib/i18n';
import { db } from '$lib/server/db';
import { activeRoster, lastPublishedAt } from '$lib/server/db/members';
import { asOfDay, isStale } from '$lib/server/roster/freshness';

export const load = async ({ params }) => {
	const language = isLanguage(params.lang) ? params.lang : 'de';
	const [roster, publishedAt] = await Promise.all([
		activeRoster(db, language),
		lastPublishedAt(db)
	]);
	return {
		councils: groupRoster(roster, language),
		total: roster.length,
		stale: isStale(publishedAt, new Date()),
		asOf: asOfDay(publishedAt)
	};
};
