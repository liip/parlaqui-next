import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { UUID, guarded } from '$lib/server/game/http';
import { shareGame } from '$lib/server/game/share';
import { GameRefusal } from '$lib/server/game/store';

export const POST = guarded(async ({ params, locals }) => {
	const visitorId = locals.visitorId;
	if (!params.id || !UUID.test(params.id) || !visitorId) {
		throw new GameRefusal(404, 'game.notFound');
	}

	return json({ token: await shareGame(db, { gameId: params.id, visitorId }) });
});
