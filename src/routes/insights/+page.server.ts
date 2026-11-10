import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { OTHER_REFERRER, insights, insightsSpan } from '$lib/server/analytics';
import { db } from '$lib/server/db';
import { INSIGHTS_COOKIE, sessionValid } from '$lib/server/insights-session';
import { tokenUsable } from '$lib/server/token';

// the same 404 as without a token at all, so the page does not tell anyone it is here
export const load = async ({ cookies, url }) => {
	const token = env.INSIGHTS_TOKEN;
	if (!tokenUsable(token) || !sessionValid(cookies.get(INSIGHTS_COOKIE), token, new Date())) {
		throw error(404);
	}
	const report = await insights(db, new Date(), insightsSpan(url.searchParams.get('days')));
	// the page is in French; /api/insights keeps the stored value
	const referrers = report.referrers.map((referrer) => ({
		...referrer,
		label: referrer.host === OTHER_REFERRER ? 'autre' : referrer.host
	}));
	return { report: { ...report, referrers } };
};
