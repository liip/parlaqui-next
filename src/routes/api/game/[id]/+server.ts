import { db } from '$lib/server/db';
import { UUID, guarded } from '$lib/server/game/http';
import { GameRefusal, forgetGame } from '$lib/server/game/store';

export const DELETE = guarded(async ({ params, locals }) => {
	const visitorId = locals.visitorId;
	if (!params.id || !UUID.test(params.id) || !visitorId) {
		throw new GameRefusal(404, 'game.notFound');
	}

	await forgetGame(db, { gameId: params.id, visitorId });
	return new Response(null, { status: 204 });
});
