import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { UUID, guarded } from '$lib/server/game/http';
import { GameRefusal } from '$lib/server/game/store';
import { gameSummary } from '$lib/server/game/summary';

export const GET = guarded(async ({ params, locals }) => {
	const visitorId = locals.visitorId;
	if (!params.id || !UUID.test(params.id) || !visitorId) {
		throw new GameRefusal(404, 'game.notFound');
	}

	const summary = await gameSummary(db, { gameId: params.id, visitorId });
	return json(summary, { headers: { 'cache-control': 'no-store' } });
});
