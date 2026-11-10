import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { findPhoto, markPhotoServed } from '$lib/server/game/store';
import { forgetBusy, rememberBusy } from '$lib/server/photo/busy';
import { forgetSource, loadSource } from '$lib/server/photo/source';
import { renderVariant } from '$lib/server/photo/variant';
import { RenderOverload, createRenderCache, overloaded } from '$lib/server/render-cache';
import type { RequestHandler } from './$types';

const TOKEN = /^[A-Za-z0-9_-]{22}$/;

// a school class starting together asks for about thirty photos at once
const variants = createRenderCache({ size: 300, concurrency: 4, maxWaiting: 400 });

export const GET: RequestHandler = async ({ params }) => {
	if (!TOKEN.test(params.token)) error(404);

	const photo = await findPhoto(db, params.token);
	if (!photo) error(404);

	let image: Buffer;
	try {
		// a photo already rendered is served even when its source is gone; otherwise the source is
		// downloaded before the render queue, so a slow source never holds a render slot
		image = await (variants.peek(params.token) ??
			loadSource(photo.photoCode, photo.photoHash).then((source) =>
				variants(params.token, () => renderVariant(source, photo.crop))
			));
	} catch (cause) {
		if (cause instanceof RenderOverload) {
			rememberBusy(params.token);
			return overloaded();
		}
		forgetBusy(params.token);
		// a source that decodes but cannot be rendered must not stay cached for every later round
		forgetSource(photo.photoCode);
		const reason = cause instanceof Error ? cause.message : String(cause);
		console.warn(`photo ${photo.photoCode} could not be served: ${reason}`);
		error(502);
	}

	forgetBusy(params.token);
	await markPhotoServed(db, params.token, new Date());
	return new Response(new Uint8Array(image), {
		headers: {
			'content-type': 'image/jpeg',
			'cache-control': 'private, max-age=3600',
			'x-content-type-options': 'nosniff'
		}
	});
};
