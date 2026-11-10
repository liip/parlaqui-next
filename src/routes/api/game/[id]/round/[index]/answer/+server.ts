import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { guarded, roundTarget } from '$lib/server/game/http';
import { GameRefusal, answerRound } from '$lib/server/game/store';
import { readJsonObject } from '$lib/server/json';

const isMemberId = (value: unknown): value is number =>
	Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 2_147_483_647;

export const POST = guarded(async (event) => {
	const target = roundTarget(event);
	const { memberId } = await readJsonObject(event.request);
	if (memberId !== null && !isMemberId(memberId)) throw new GameRefusal(400, 'game.error');

	return json(await answerRound(db, { ...target, memberId, now: new Date() }));
});
