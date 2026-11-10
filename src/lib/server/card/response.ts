import { error } from '@sveltejs/kit';
import { MAX_POINTS_PER_ROUND } from '$lib/game/protocol';
import { isLanguage, isOne, translate } from '$lib/i18n';
import { db } from '$lib/server/db';
import { sharedGame } from '$lib/server/game/share';
import { RenderOverload, createRenderCache, overloaded } from '$lib/server/render-cache';
import { renderCard } from './card';

const cached = createRenderCache({ size: 100, concurrency: 4, maxWaiting: 50 });

export async function cardResponse(lang: string, token: string): Promise<Response> {
	if (!isLanguage(lang)) throw error(404);
	const shared = await sharedGame(db, token);
	if (!shared) throw error(404);
	const council = translate(
		lang,
		shared.council === 'all' ? 'end.councilAll' : `council.${shared.council}`
	);
	const max = shared.total * MAX_POINTS_PER_ROUND;
	const text = {
		label: translate(lang, 'share.cardLabel'),
		tagline: translate(lang, 'share.cardTagline'),
		score: shared.score,
		outOf: translate(lang, 'end.outOf', { max }),
		council,
		correct: translate(
			lang,
			isOne(lang, shared.correct) ? 'share.cardCorrectOne' : 'share.cardCorrect',
			{
				correct: shared.correct,
				total: shared.total
			}
		),
		challenge: translate(lang, 'share.challenge'),
		by: translate(lang, 'share.cardBy'),
		photoCredit: translate(lang, 'share.cardPhoto')
	};
	// keyed by what the card shows, so equal results share one render
	const key = [lang, shared.score, shared.total, shared.correct, shared.council].join(':');
	let image: Buffer;
	try {
		image = await cached(key, () => renderCard(text));
	} catch (cause) {
		if (cause instanceof RenderOverload) return overloaded();
		throw cause;
	}
	return new Response(new Uint8Array(image), {
		headers: {
			'content-type': 'image/jpeg',
			'cache-control': 'public, max-age=86400',
			'x-robots-tag': 'noindex'
		}
	});
}
