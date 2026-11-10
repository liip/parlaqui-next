import { GameRefusal } from './game/store';

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
	const body: unknown = await request.json().catch(() => null);
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		throw new GameRefusal(400, 'game.error');
	}
	return body as Record<string, unknown>;
}
