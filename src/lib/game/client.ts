import { de } from '$lib/i18n/de';
import type { Language, MessageKey } from '$lib/i18n';
import {
	ROUND_MS,
	isCouncilChoice,
	type CouncilChoice,
	type GameSummary,
	type OpenRound,
	type PublicOption,
	type PublicRound,
	type ReplacedRound,
	type StartedGame,
	type Verdict
} from './protocol';

const REQUEST_TIMEOUT_MS = 8_000;
const NO_RESPONSE = 0;
const RETRIED_STATUSES = [NO_RESPONSE, 502, 503, 504];
const GATEWAY_BACKOFF_MS = { min: 300, max: 800 };

export class GameError extends Error {
	readonly status: number;
	readonly key: MessageKey;

	constructor(status: number, key: MessageKey) {
		super(key);
		this.name = 'GameError';
		this.status = status;
		this.key = key;
	}
}

const isMessageKey = (value: unknown): value is MessageKey =>
	typeof value === 'string' && Object.hasOwn(de, value);

const readBody = async (response: Response): Promise<unknown> => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

type Guard<T> = (value: unknown) => value is T;

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isNumber = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);

const isPublicRound = (value: unknown): value is PublicRound =>
	isObject(value) && isNumber(value.index) && typeof value.photoUrl === 'string';

// a container still running the previous version during a deploy sends no council
type PreviousStartedGame = Omit<StartedGame, 'council'> & Partial<Pick<StartedGame, 'council'>>;

const isStartedGame = (value: unknown): value is PreviousStartedGame =>
	isObject(value) &&
	typeof value.gameId === 'string' &&
	isNumber(value.total) &&
	(value.council === undefined || isCouncilChoice(value.council)) &&
	isPublicRound(value.round);

// and only remainingMs where the current version sends deadline and serverNow
type PreviousOpenRound = Pick<OpenRound, 'index' | 'options' | 'remainingMs'> & {
	deadline?: undefined;
};

const isOpenOrReplaced = (value: unknown): value is OpenRound | PreviousOpenRound | ReplacedRound =>
	isObject(value) &&
	(value.replaced === true
		? isPublicRound(value.round)
		: isNumber(value.index) &&
			Array.isArray(value.options) &&
			(value.deadline === undefined
				? isNumber(value.remainingMs)
				: isNumber(value.deadline) && isNumber(value.serverNow)));

const isVerdict = (value: unknown): value is Verdict =>
	isObject(value) &&
	isNumber(value.index) &&
	typeof value.correct === 'boolean' &&
	isObject(value.answer) &&
	isNumber(value.points) &&
	isNumber(value.score) &&
	isNumber(value.correctCount) &&
	(value.next === null || isPublicRound(value.next)) &&
	typeof value.finished === 'boolean' &&
	isNumber(value.revealMs);

const isShareToken = (value: unknown): value is { token: string } =>
	isObject(value) && typeof value.token === 'string';

type Reply<T> = { payload: T; roundTripMs: number };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const gatewayBackoffMs = () =>
	GATEWAY_BACKOFF_MS.min + Math.random() * (GATEWAY_BACKOFF_MS.max - GATEWAY_BACKOFF_MS.min);

const post = async <T>(
	fetcher: typeof fetch,
	url: string,
	body: unknown,
	isExpected: Guard<T>
): Promise<Reply<T>> => {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	const sentAt = performance.now();
	try {
		const response = await fetcher(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
			signal: controller.signal
		});
		const payload = await readBody(response);
		if (response.ok) {
			// a cut-off body reads as null: the request may have counted, but its answer was lost
			if (!isExpected(payload)) throw new GameError(NO_RESPONSE, 'game.error');
			return { payload, roundTripMs: performance.now() - sentAt };
		}
		const message = (payload as { message?: unknown } | null)?.message;
		throw new GameError(response.status, isMessageKey(message) ? message : 'game.error');
	} catch (cause) {
		if (cause instanceof GameError) throw cause;
		throw new GameError(NO_RESPONSE, 'game.error');
	} finally {
		clearTimeout(timeout);
	}
};

// only for the round requests, which the server answers the same way when they come twice
const postRetryingOnce = async <T>(
	fetcher: typeof fetch,
	url: string,
	body: unknown,
	isExpected: Guard<T>
): Promise<Reply<T>> => {
	try {
		return await post(fetcher, url, body, isExpected);
	} catch (cause) {
		if (!(cause instanceof GameError) || !RETRIED_STATUSES.includes(cause.status)) throw cause;
		if (cause.status !== NO_RESPONSE) await sleep(gatewayBackoffMs());
		return post(fetcher, url, body, isExpected);
	}
};

export const startGame = async (
	fetcher: typeof fetch,
	council: CouncilChoice,
	language: Language
): Promise<StartedGame> => {
	const { payload } = await post(fetcher, '/api/game', { council, language }, isStartedGame);
	return { ...payload, council: payload.council ?? council };
};

type OpenedRound = { index: number; options: PublicOption[]; remainingMs: number };

// the response took about half the round trip to arrive, so that much of the time is already gone
const lessHalfTheTrip = (leftMs: number, roundTripMs: number): number =>
	Math.max(0, Math.floor(Math.min(leftMs, ROUND_MS) - Math.max(0, roundTripMs) / 2));

export const remainingMsOf = (
	{ deadline, serverNow }: { deadline: number; serverNow: number },
	roundTripMs: number
): number => lessHalfTheTrip(deadline - serverNow, roundTripMs);

const timeLeftOf = (round: OpenRound | PreviousOpenRound, roundTripMs: number): number => {
	if (round.deadline === undefined) return lessHalfTheTrip(round.remainingMs, roundTripMs);
	return remainingMsOf({ deadline: round.deadline, serverNow: round.serverNow }, roundTripMs);
};

// randomUUID needs a secure context, which a plain http address is not
const attemptId = () =>
	globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const openRound = async (
	fetcher: typeof fetch,
	gameId: string,
	index: number,
	failedPhotoUrl?: string
): Promise<OpenedRound | ReplacedRound> => {
	const { payload, roundTripMs } = await postRetryingOnce(
		fetcher,
		`/api/game/${gameId}/round/${index}/start`,
		// the attempt id stays the same when the request is sent again
		failedPhotoUrl ? { photoFailed: true, photoUrl: failedPhotoUrl, attempt: attemptId() } : {},
		isOpenOrReplaced
	);
	if ('replaced' in payload) return payload;
	return {
		index: payload.index,
		options: payload.options,
		remainingMs: timeLeftOf(payload, roundTripMs)
	};
};

export const sendAnswer = async (
	fetcher: typeof fetch,
	gameId: string,
	index: number,
	memberId: number | null
): Promise<Verdict> =>
	(
		await postRetryingOnce(
			fetcher,
			`/api/game/${gameId}/round/${index}/answer`,
			{ memberId },
			isVerdict
		)
	).payload;

// the end screen works without it, so any failure just leaves the summary out
export const fetchSummary = async (
	fetcher: typeof fetch,
	gameId: string
): Promise<GameSummary | null> => {
	try {
		const response = await fetcher(`/api/game/${gameId}/summary`, {
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
		return response.ok ? ((await response.json()) as GameSummary) : null;
	} catch {
		return null;
	}
};

// null when the link could not be made; the end screen then says so instead of sharing nothing
export const shareScore = async (fetcher: typeof fetch, gameId: string): Promise<string | null> => {
	try {
		return (await post(fetcher, `/api/game/${gameId}/share`, {}, isShareToken)).payload.token;
	} catch {
		return null;
	}
};
