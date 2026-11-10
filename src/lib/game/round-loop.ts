import type { MessageKey } from '$lib/i18n';
import { GameError, openRound, sendAnswer } from './client';
import type { PublicOption, PublicRound, Revealed, StartedGame, Verdict } from './protocol';

export type Phase = 'loading' | 'playing' | 'pending' | 'revealing' | 'finished' | 'failed';

export type PhotoStatus = 'ok' | 'retrying' | 'replacing';

export type LoopState = {
	phase: Phase;
	index: number;
	total: number;
	photoUrl: string;
	photoStatus: PhotoStatus;
	options: PublicOption[];
	remainingMs: number;
	chosenId: number | null;
	verdict: Verdict | null;
	points: (number | null)[];
	score: number;
	correctCount: number;
	missed: (Revealed & { photoUrl: string })[];
	error: MessageKey | null;
};

type Deps = { fetcher: typeof fetch; onChange(state: LoopState): void };

export const initialState = (round: PublicRound, total: number): LoopState => ({
	phase: 'loading',
	index: round.index,
	total,
	photoUrl: round.photoUrl,
	photoStatus: 'ok',
	options: [],
	remainingMs: 0,
	chosenId: null,
	verdict: null,
	points: [],
	score: 0,
	correctCount: 0,
	missed: [],
	error: null
});

const PHOTO_RETRY_DELAYS_MS = [500, 1_500];
// the server refuses a photo for load with retry-after: 2
const BUSY_RETRY_MS = 2_000;

const withRetry = (url: string, attempt: number) =>
	`${url}${url.includes('?') ? '&' : '?'}retry=${attempt}`;

export const createRoundLoop = (game: StartedGame, { fetcher, onChange }: Deps) => {
	let destroyed = false;
	let opening = false;
	let photoFailures = 0;
	let photoReloads = 0;
	let baseUrl = game.round.photoUrl;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;

	let state = initialState(game.round, game.total);

	const update = (patch: Partial<LoopState>) => {
		if (destroyed) return;
		state = { ...state, ...patch };
		onChange(state);
	};

	const stopTimer = () => {
		clearTimeout(timer);
		clearTimeout(retryTimer);
		timer = undefined;
		retryTimer = undefined;
	};

	const fail = (cause: unknown) => {
		stopTimer();
		update({
			phase: 'failed',
			error: cause instanceof GameError ? cause.key : 'game.error'
		});
	};

	const startRound = (round: PublicRound, photoStatus: PhotoStatus = 'ok') => {
		baseUrl = round.photoUrl;
		photoFailures = 0;
		photoReloads = 0;
		update({
			phase: 'loading',
			index: round.index,
			photoUrl: round.photoUrl,
			photoStatus,
			options: [],
			remainingMs: 0,
			chosenId: null,
			verdict: null
		});
	};

	// a new query each time, so the browser never reuses the load that failed
	const reloadPhoto = (delayMs: number) => {
		update({ photoStatus: 'retrying' });
		retryTimer = setTimeout(() => {
			retryTimer = undefined;
			update({ photoUrl: withRetry(baseUrl, ++photoReloads) });
		}, delayMs);
	};

	const preload = (url: string) => {
		if (typeof Image === 'undefined') return;
		new Image().src = url;
	};

	const reveal = (verdict: Verdict) => {
		const missed = verdict.correct
			? state.missed
			: [...state.missed, { ...verdict.answer, photoUrl: state.photoUrl }];
		update({
			phase: 'revealing',
			verdict,
			points: [...state.points, verdict.points],
			score: verdict.score,
			correctCount: verdict.correctCount,
			missed
		});
		if (verdict.next) preload(verdict.next.photoUrl);
		timer = setTimeout(() => {
			if (verdict.next && !verdict.finished) return startRound(verdict.next);
			update({ phase: 'finished' });
		}, verdict.revealMs);
	};

	const submit = async (memberId: number | null) => {
		stopTimer();
		update({ phase: 'pending', chosenId: memberId });
		try {
			const verdict = await sendAnswer(fetcher, game.gameId, state.index, memberId);
			if (destroyed) return;
			reveal(verdict);
		} catch (cause) {
			fail(cause);
		}
	};

	const requestOpen = async (failedPhotoUrl?: string) => {
		opening = true;
		try {
			const result = await openRound(fetcher, game.gameId, state.index, failedPhotoUrl);
			if (destroyed) return;
			if ('replaced' in result && result.round.photoUrl === baseUrl) {
				// the server was only busy: the same round again, the replacement still unspent
				photoFailures = 0;
				return reloadPhoto(BUSY_RETRY_MS);
			}
			if ('replaced' in result) return startRound(result.round, 'replacing');
			update({
				phase: 'playing',
				photoStatus: 'ok',
				options: result.options,
				remainingMs: result.remainingMs
			});
			timer = setTimeout(() => void submit(null), result.remainingMs);
		} catch (cause) {
			fail(cause);
		} finally {
			opening = false;
		}
	};

	const canOpen = () => !destroyed && state.phase === 'loading' && !opening;

	return {
		photoLoaded() {
			if (!canOpen()) return;
			void requestOpen();
		},
		photoFailed() {
			if (!canOpen() || retryTimer) return;
			photoFailures += 1;
			if (photoFailures > PHOTO_RETRY_DELAYS_MS.length) {
				update({ photoStatus: 'replacing' });
				return void requestOpen(baseUrl);
			}
			reloadPhoto(PHOTO_RETRY_DELAYS_MS[photoFailures - 1]);
		},
		choose(memberId: number) {
			if (destroyed || state.phase !== 'playing') return;
			void submit(memberId);
		},
		destroy() {
			destroyed = true;
			stopTimer();
		}
	};
};
