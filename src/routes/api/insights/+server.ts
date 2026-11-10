import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { insights, insightsSpan } from '$lib/server/analytics';
import { db } from '$lib/server/db';
import { requireToken } from '$lib/server/token';

export const GET = async ({ request, url }) => {
	requireToken(request, env.INSIGHTS_TOKEN);
	return json(await insights(db, new Date(), insightsSpan(url.searchParams.get('days'))), {
		headers: { 'cache-control': 'no-store' }
	});
};
