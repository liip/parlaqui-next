import { error } from '@sveltejs/kit';
import sharp from 'sharp';
import { db } from '$lib/server/db';
import { memberPhoto } from '$lib/server/db/members';
import { loadSource } from '$lib/server/photo/source';
import { RenderOverload, createRenderCache, overloaded } from '$lib/server/render-cache';

const ID = /^[0-9]{1,9}$/;
const SIDE = 112;
// the members page asks for all 246 portraits at once when the cache is cold
const cached = createRenderCache({ size: 300, concurrency: 4, maxWaiting: 500 });

// the members list shows each portrait openly next to its name, so unlike a round photo it has a fixed address
export const GET = async ({ params }) => {
	if (!ID.test(params.id)) throw error(404);
	const photo = await memberPhoto(db, Number(params.id));
	if (!photo) throw error(404);

	let image: Buffer;
	try {
		// a portrait already rendered is served even when its source is gone; otherwise the source
		// is downloaded before the render queue, so a slow source never holds a render slot
		const key = `${photo.code}:${photo.hash}`;
		image = await (cached.peek(key) ??
			loadSource(photo.code, photo.hash).then((source) =>
				cached(key, () =>
					sharp(source)
						.resize(SIDE, SIDE, { fit: 'cover', position: 'attention' })
						.jpeg({ quality: 78, mozjpeg: true })
						.toBuffer()
				)
			));
	} catch (cause) {
		if (cause instanceof RenderOverload) return overloaded();
		throw error(502);
	}
	return new Response(new Uint8Array(image), {
		headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' }
	});
};
