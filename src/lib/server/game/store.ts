import { randomBytes, randomUUID } from 'node:crypto';
import {
	RESULT_MS,
	type CouncilChoice,
	type OpenRound,
	type PublicOption,
	type PublicRound,
	type ReplacedRound,
	type StartedGame,
	type Verdict
} from '$lib/game/protocol';
import type { Language, MessageKey } from '$lib/i18n';
import { countGameStarted } from '../analytics';
import { membersByIds } from '../db/members';
import { sql, toBool, toDate, type Db } from '../db/sqlite';
import type { Crop } from '../photo/variant';
import { zurichDay } from '../zurich';
import type { DealtRound } from './deal';
import {
	IMPLAUSIBLE_MEDIAN_MS,
	IMPLAUSIBLE_MIN_CORRECT,
	clockStartsAt,
	deadlineOf,
	isLate,
	pointsFor,
	remainingMs
} from './timing';

export class GameRefusal extends Error {
	readonly status: 400 | 404 | 409 | 503;
	readonly key: MessageKey;

	constructor(status: 400 | 404 | 409 | 503, key: MessageKey) {
		super(key);
		this.name = 'GameRefusal';
		this.status = status;
		this.key = key;
	}
}

type GameRow = {
	id: string;
	language: Language;
	total: number;
	roundIndex: number;
	replaced: number;
	finished: boolean;
};

type RoundRow = {
	id: number;
	index: number;
	memberId: number;
	optionIds: number[];
	photoToken: string;
	readyAt: Date | null;
	photoServedAt: Date | null;
	clockStartedAt: Date | null;
	answeredAt: Date | null;
	correct: boolean | null;
	points: number | null;
};

type RoundRef = { gameId: string; visitorId: string; index: number; now: Date };

const newPhotoToken = () => randomBytes(16).toString('base64url');

const publicRound = (index: number, photoToken: string): PublicRound => ({
	index,
	photoUrl: `/photo/${photoToken}`
});

export const photoTokenOf = (photoUrl: unknown): string | null =>
	typeof photoUrl === 'string' && photoUrl.startsWith('/photo/')
		? photoUrl.slice('/photo/'.length).split('?')[0]
		: null;

const revealMsOf = (correct: boolean) => (correct ? RESULT_MS.right : RESULT_MS.wrong);

function insertRound(
	db: Db,
	gameId: string,
	index: number,
	round: DealtRound,
	readyAt: Date | null
): string {
	const photoToken = newPhotoToken();
	db.run(sql`
		insert into game_round (game_id, round_index, member_id, option_ids, photo_token, photo_code, crop, ready_at)
		values (${gameId}, ${index}, ${round.memberId}, ${JSON.stringify(round.optionIds)}, ${photoToken},
			${round.photoCode}, ${JSON.stringify(round.crop)}, ${readyAt})
	`);
	return photoToken;
}

function gameOf(db: Db, gameId: string, visitorId: string): GameRow {
	const row = db.get<{
		id: string;
		visitor_id: string | null;
		language: Language;
		total: number;
		round_index: number;
		replaced: number;
		finished_at: number | null;
	}>(sql`
		select id, visitor_id, language, total, round_index, replaced, finished_at
		from game
		where id = ${gameId}
	`);
	if (!row || row.visitor_id !== visitorId) throw new GameRefusal(404, 'game.notFound');

	return {
		id: row.id,
		language: row.language,
		total: row.total,
		roundIndex: row.round_index,
		replaced: row.replaced,
		finished: row.finished_at !== null
	};
}

function liveRound(db: Db, gameId: string, index: number): RoundRow | null {
	const row = db.get<{
		id: number;
		round_index: number;
		member_id: number;
		option_ids: string;
		photo_token: string;
		ready_at: number | null;
		photo_served_at: number | null;
		clock_started_at: number | null;
		answered_at: number | null;
		correct: number | null;
		points: number | null;
	}>(sql`
		select id, round_index, member_id, option_ids, photo_token, ready_at, photo_served_at,
			clock_started_at, answered_at, correct, points
		from game_round
		where game_id = ${gameId} and round_index = ${index} and voided_at is null
	`);
	if (!row) return null;

	return {
		id: row.id,
		index: row.round_index,
		memberId: row.member_id,
		optionIds: JSON.parse(row.option_ids),
		photoToken: row.photo_token,
		readyAt: toDate(row.ready_at),
		photoServedAt: toDate(row.photo_served_at),
		clockStartedAt: toDate(row.clock_started_at),
		answeredAt: toDate(row.answered_at),
		correct: toBool(row.correct),
		points: row.points
	};
}

function currentRound(game: GameRow, index: number, round: RoundRow | null): RoundRow {
	if (game.finished) throw new GameRefusal(409, 'game.over');
	if (!round || index !== game.roundIndex) throw new GameRefusal(409, 'game.stale');
	return round;
}

function readyRound(game: GameRow, index: number, round: RoundRow | null, now: Date): RoundRow {
	const current = currentRound(game, index, round);
	if (!current.readyAt || current.readyAt > now) throw new GameRefusal(409, 'game.stale');
	return current;
}

export async function createGame(
	db: Db,
	{
		visitorId,
		council,
		language,
		rounds,
		now
	}: {
		visitorId: string;
		council: CouncilChoice;
		language: Language;
		rounds: DealtRound[];
		now: Date;
	}
): Promise<StartedGame> {
	const gameId = randomUUID();
	const firstToken = db.tx(() => {
		db.run(sql`
			insert into game (id, visitor_id, council, language, total, started_at)
			values (${gameId}, ${visitorId}, ${council}, ${language}, ${rounds.length}, ${now})
		`);
		db.run(sql`update visitor set last_game_at = ${now} where id = ${visitorId}`);
		const tokens = rounds.map((round, index) =>
			insertRound(db, gameId, index, round, index === 0 ? now : null)
		);
		countGameStarted(db, zurichDay(now));
		return tokens[0];
	});

	return { gameId, total: rounds.length, council, round: publicRound(0, firstToken) };
}

// the owner takes the game back as if never played, so a check run leaves no trace in the figures
export async function forgetGame(
	db: Db,
	{ gameId, visitorId }: { gameId: string; visitorId: string }
): Promise<void> {
	db.tx(() => {
		const game = db.get<{ startedAt: number }>(sql`
			select started_at as startedAt from game where id = ${gameId} and visitor_id = ${visitorId}
		`);
		if (!game) throw new GameRefusal(404, 'game.notFound');
		db.run(sql`delete from game_round where game_id = ${gameId}`);
		db.run(sql`delete from game where id = ${gameId}`);
		db.run(sql`
			update games_started_day set started = max(started - 1, 0)
			where day = ${zurichDay(toDate(game.startedAt)!)}
		`);
		db.run(sql`
			delete from visitor where id = ${visitorId}
			and not exists (select 1 from game where visitor_id = ${visitorId})
		`);
	});
}

// the browser takes half its round trip off the time left, and that trip includes the work done
// here; stamped at the middle of that work, the answer has it counted once, not half or twice
export async function startRound(
	db: Db,
	{ gameId, visitorId, index, now, clock }: RoundRef & { clock?: () => Date }
): Promise<OpenRound> {
	const { language, optionIds, clockStartedAt } = db.tx(() => {
		const game = gameOf(db, gameId, visitorId);
		const round = readyRound(game, index, liveRound(db, gameId, index), now);
		const clockStartedAt =
			round.clockStartedAt ??
			clockStartsAt({ readyAt: round.readyAt ?? now, photoServedAt: round.photoServedAt }, now);
		if (!round.clockStartedAt) {
			db.run(
				sql`update game_round set clock_started_at = ${clockStartedAt} where id = ${round.id}`
			);
		}
		return { language: game.language, optionIds: round.optionIds, clockStartedAt };
	});

	const members = await membersByIds(db, optionIds, language);
	const options = optionIds.flatMap((id): PublicOption[] => {
		const member = members.get(id);
		if (!member) return [];
		return [
			{ id: member.id, firstName: member.firstName, lastName: member.lastName, party: member.party }
		];
	});

	const sentAt = clock?.() ?? now;
	const stamp = new Date((now.getTime() + sentAt.getTime()) / 2);
	return {
		index,
		options,
		deadline: deadlineOf(clockStartedAt),
		serverNow: stamp.getTime(),
		remainingMs: remainingMs(clockStartedAt, stamp)
	};
}

export async function replacementContext(
	db: Db,
	{ gameId, visitorId, index }: { gameId: string; visitorId: string; index: number }
): Promise<{ council: CouncilChoice; dealt: Set<number>; earlierAnswers: Set<number> }> {
	const game = db.get<{ council: CouncilChoice }>(
		sql`select council from game where id = ${gameId} and visitor_id = ${visitorId}`
	);
	if (!game) throw new GameRefusal(404, 'game.notFound');

	const rows = db.all<{ member_id: number; earlier: number }>(sql`
		select member_id, round_index < ${index} and voided_at is null as earlier
		from game_round where game_id = ${gameId}
	`);
	return {
		council: game.council,
		dealt: new Set<number>(rows.map((row) => row.member_id)),
		earlierAnswers: new Set<number>(
			rows.filter((row) => row.earlier === 1).map((row) => row.member_id)
		)
	};
}

function wasReplacedBy(db: Db, gameId: string, index: number, photoToken: string | null): boolean {
	if (!photoToken) return false;

	const row = db.get(sql`
		select 1 from game_round
		where game_id = ${gameId} and round_index = ${index} and photo_token = ${photoToken}
			and voided_at is not null
	`);
	return row !== undefined;
}

export async function replaceRound(
	db: Db,
	{
		gameId,
		visitorId,
		index,
		now,
		replacement,
		failedPhotoToken = null,
		photoWasBusy = false
	}: RoundRef & {
		replacement: DealtRound | undefined;
		failedPhotoToken?: string | null;
		photoWasBusy?: boolean;
	}
): Promise<ReplacedRound> {
	const photoToken = db.tx(() => {
		const game = gameOf(db, gameId, visitorId);
		const round = currentRound(game, index, liveRound(db, gameId, index));
		if (round.clockStartedAt) throw new GameRefusal(409, 'game.photoTrouble');

		// the photo was only refused for load, so the browser tries the same round again
		if (photoWasBusy && failedPhotoToken === round.photoToken) return round.photoToken;
		// the same request again, after its response was lost
		if (wasReplacedBy(db, gameId, index, failedPhotoToken)) return round.photoToken;
		if (game.replaced >= 1 || !replacement) throw new GameRefusal(409, 'game.photoTrouble');

		db.run(sql`update game_round set voided_at = ${now} where id = ${round.id}`);
		db.run(sql`update game set replaced = replaced + 1, unranked = 'photo' where id = ${gameId}`);
		return insertRound(db, gameId, index, replacement, now);
	});

	return { replaced: true, round: publicRound(index, photoToken) };
}

async function verdictOf(db: Db, game: GameRow, round: RoundRow): Promise<Verdict> {
	const totals = db.get<{ score: number; count: number }>(sql`
		select coalesce(sum(points), 0) as score, count(*) filter (where correct) as count
		from game_round
		where game_id = ${game.id} and voided_at is null and round_index <= ${round.index}
	`)!;
	const next = liveRound(db, game.id, round.index + 1);
	const answer = (await membersByIds(db, [round.memberId], game.language)).get(round.memberId);
	if (!answer) throw new Error(`member ${round.memberId} of a dealt round is missing`);

	const correct = round.correct === true;
	return {
		index: round.index,
		correct,
		answer,
		points: round.points ?? 0,
		score: totals.score,
		correctCount: totals.count,
		next: next ? publicRound(next.index, next.photoToken) : null,
		finished: round.index + 1 >= game.total,
		revealMs: revealMsOf(correct)
	};
}

type UnrankedReason = 'unstarted' | 'fast';

// the middle value, or the mean of the two middle ones
function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = values.toSorted((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function unrankedAtFinish(db: Db, gameId: string): UnrankedReason | null {
	const rows = db.all<{
		clock_started_at: number | null;
		answered_at: number;
		correct: number;
	}>(sql`
		select clock_started_at, answered_at, correct
		from game_round
		where game_id = ${gameId} and voided_at is null
	`);
	// a script that answers without ever asking for the names would only drag others up
	if (rows.some((row) => row.clock_started_at === null)) return 'unstarted';
	const correct = rows.filter((row) => row.correct === 1).length;
	const medianMs = median(rows.map((row) => row.answered_at - row.clock_started_at!));
	return correct >= IMPLAUSIBLE_MIN_CORRECT && medianMs !== null && medianMs < IMPLAUSIBLE_MEDIAN_MS
		? 'fast'
		: null;
}

export async function answerRound(
	db: Db,
	{ gameId, visitorId, index, memberId, now }: RoundRef & { memberId: number | null }
): Promise<Verdict> {
	const { game, round } = db.tx(() => {
		const game = gameOf(db, gameId, visitorId);
		const live = liveRound(db, gameId, index);
		if (live?.answeredAt) return { game, round: live };

		const round = readyRound(game, index, live, now);
		// a round whose options were never asked for cannot have been answered honestly
		const clock = round.clockStartedAt;
		const correct = clock !== null && memberId === round.memberId && !isLate(clock, now);
		const points = clock && correct ? pointsFor(clock, now) : 0;
		const last = index + 1 >= game.total;

		db.run(sql`
			update game_round set
				answered_at = ${now}, chosen_id = ${memberId}, correct = ${correct}, points = ${points}
			where id = ${round.id}
		`);
		if (!last) {
			db.run(sql`
				update game_round set ready_at = ${new Date(now.getTime() + revealMsOf(correct))}
				where game_id = ${gameId} and round_index = ${index + 1} and voided_at is null
			`);
		}
		const unranked = last ? unrankedAtFinish(db, gameId) : null;
		db.run(sql`
			update game set
				round_index = ${index + 1}, score = score + ${points},
				correct = correct + ${correct ? 1 : 0}, finished_at = ${last ? now : null},
				unranked = coalesce(unranked, ${unranked})
			where id = ${gameId}
		`);
		return { game, round: { ...round, answeredAt: now, correct, points } };
	});

	return verdictOf(db, game, round);
}

// only the first time writes: a retry, the end screen or a flood asking again changes no row
export async function markPhotoServed(db: Db, token: string, now: Date): Promise<boolean> {
	const changes = db.run(sql`
		update game_round set photo_served_at = ${now}
		where photo_token = ${token} and voided_at is null and photo_served_at is null
	`);
	return changes > 0;
}

export async function findPhoto(
	db: Db,
	token: string
): Promise<{ photoCode: string; photoHash: string | null; crop: Crop } | null> {
	const row = db.get<{ photo_code: string; crop: string; photo_hash: string | null }>(sql`
		select r.photo_code, r.crop, case when m.photo_code = r.photo_code then m.photo_hash end as photo_hash
		from game_round r join member m on m.id = r.member_id
		where r.photo_token = ${token} and r.voided_at is null
	`);
	if (!row) return null;

	return { photoCode: row.photo_code, photoHash: row.photo_hash, crop: JSON.parse(row.crop) };
}
