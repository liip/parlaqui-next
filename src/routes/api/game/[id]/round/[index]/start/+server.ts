import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { playableMembers } from '$lib/server/db/members';
import { dealRounds } from '$lib/server/game/deal';
import { guarded, roundTarget } from '$lib/server/game/http';
import { photoTokenOf, replaceRound, replacementContext, startRound } from '$lib/server/game/store';
import { readJsonObject } from '$lib/server/json';
import { takeBusy } from '$lib/server/photo/busy';

const ATTEMPT = /^[A-Za-z0-9-]{8,64}$/;

export const POST = guarded(async (event) => {
	const target = roundTarget(event);
	const body = await readJsonObject(event.request);
	const now = new Date();
	if (body.photoFailed !== true) {
		return json(await startRound(db, { ...target, now, clock: () => new Date() }));
	}

	const { council, dealt, earlierAnswers } = await replacementContext(db, target);
	const [replacement] = dealRounds(await playableMembers(db, council), 1, {
		exclude: dealt,
		earlierAnswers
	});
	const failedPhotoToken = photoTokenOf(body.photoUrl);
	const attempt =
		typeof body.attempt === 'string' && ATTEMPT.test(body.attempt) ? body.attempt : null;
	const photoWasBusy = takeBusy(failedPhotoToken, attempt);

	return json(
		await replaceRound(db, { ...target, now, replacement, failedPhotoToken, photoWasBusy })
	);
});
