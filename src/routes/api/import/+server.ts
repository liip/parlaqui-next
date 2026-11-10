import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { importRoster } from '$lib/server/roster/import';
import { importDeps, importSucceeded } from '$lib/server/roster/run';
import { requireToken } from '$lib/server/token';

export const POST = async ({ request }) => {
	requireToken(request, env.IMPORT_TOKEN);

	const apiKey = env.PARL_API_KEY;
	if (!apiKey) {
		throw error(500, 'PARL_API_KEY is required to import the roster.');
	}

	const outcome = await importRoster(db, importDeps(db, apiKey, env.ROKKA_API_KEY));
	// a non-2xx answer is what makes a scheduler command exit non-zero
	return json(outcome, { status: importSucceeded(outcome) ? 200 : 502 });
};
