import { json, type RequestEvent } from '@sveltejs/kit';
import { GameRefusal } from './store';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INDEX = /^[0-9]$/;

export const guarded =
	<Event extends RequestEvent>(handler: (event: Event) => Promise<Response>) =>
	async (event: Event): Promise<Response> => {
		try {
			return await handler(event);
		} catch (failure) {
			if (!(failure instanceof GameRefusal)) throw failure;
			return json({ message: failure.key }, { status: failure.status });
		}
	};

export function roundTarget(event: RequestEvent): {
	gameId: string;
	visitorId: string;
	index: number;
} {
	const { id, index } = event.params;
	if (!id || !UUID.test(id)) throw new GameRefusal(404, 'game.notFound');
	if (!index || !INDEX.test(index)) throw new GameRefusal(400, 'game.error');

	const visitorId = event.locals.visitorId;
	if (!visitorId) throw new GameRefusal(404, 'game.notFound');

	return { gameId: id, visitorId, index: Number(index) };
}
