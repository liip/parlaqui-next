import { json } from '@sveltejs/kit';
import { ROUNDS_PER_GAME, isCouncilChoice } from '$lib/game/protocol';
import { isLanguage } from '$lib/i18n';
import { db } from '$lib/server/db';
import { playableMembers } from '$lib/server/db/members';
import { dealRounds } from '$lib/server/game/deal';
import { guarded } from '$lib/server/game/http';
import { GameRefusal, createGame } from '$lib/server/game/store';
import { readJsonObject } from '$lib/server/json';
import { ensureVisitor } from '$lib/server/visitor';

export const POST = guarded(async ({ request, cookies }) => {
	const { council, language } = await readJsonObject(request);
	if (!isCouncilChoice(council) || !isLanguage(language)) throw new GameRefusal(400, 'game.error');

	const rounds = dealRounds(await playableMembers(db, council), ROUNDS_PER_GAME);
	if (rounds.length === 0) throw new GameRefusal(503, 'game.noData');

	const visitorId = await ensureVisitor(db, cookies);
	return json(await createGame(db, { visitorId, council, language, rounds, now: new Date() }));
});
