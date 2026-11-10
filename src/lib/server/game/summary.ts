import type { CouncilChoice, GameSummary } from '$lib/game/protocol';
import { sql, toDate, type Db } from '../db/sqlite';
import { zurichDay, zurichMonth } from '../zurich';
import { GameRefusal } from './store';

const MIN_COMPARISON_GAMES = 10;
export const HISTOGRAM_TTL_MS = 60_000;
const HISTOGRAM_ENTRIES = 36;
const TOP_SCORE = 100;

// the best ranked score of each device in one council and Zurich month, as counted up to asOf: one
// entry per device, so a script replaying zero-score games from one browser weighs like one player
type Histogram = { counts: number[]; games: number; asOf: Date };

export type Histograms = Map<string, Histogram>;

export const createHistograms = (): Histograms => new Map();

const shared = createHistograms();

// ranked finished games of one council in the Zurich month of finishedAt
function inMonth(council: CouncilChoice, finishedAt: Date) {
	const { start, end } = zurichMonth(finishedAt);
	return sql`
		council = ${council} and finished_at is not null and unranked is null
		and finished_at >= ${start} and finished_at < ${end}
	`;
}

function monthHistogram(
	db: Db,
	histograms: Histograms,
	{ council, finishedAt, now }: { council: CouncilChoice; finishedAt: Date; now: Date }
): Histogram {
	const key = `${council}:${zurichDay(finishedAt).slice(0, 7)}`;
	const cached = histograms.get(key);
	if (cached && now.getTime() - cached.asOf.getTime() < HISTOGRAM_TTL_MS) return cached;

	const rows = db.all<{ score: number; games: number }>(sql`
		select score, count(*) as games
		from (
			select max(score) as score
			from game
			where ${inMonth(council, finishedAt)} and finished_at <= ${now}
			group by coalesce(visitor_id, id)
		) as best
		group by score
	`);
	const counts = Array<number>(TOP_SCORE + 1).fill(0);
	for (const row of rows) counts[row.score] += row.games;
	const histogram = { counts, games: rows.reduce((sum, row) => sum + row.games, 0), asOf: now };

	histograms.delete(key);
	const oldest = histograms.keys().next();
	if (histograms.size >= HISTOGRAM_ENTRIES && !oldest.done) histograms.delete(oldest.value);
	histograms.set(key, histogram);
	return histogram;
}

function betterThan(
	db: Db,
	histograms: Histograms,
	game: { council: CouncilChoice; score: number; finishedAt: Date; visitorId: string },
	now: Date
): number | null {
	const histogram = monthHistogram(db, histograms, { ...game, now });
	// the device's own entry in the counts is its best as of when they were taken, which can be
	// below this score when the counts are cached from before this game
	const own = db.get<{ best: number | null }>(sql`
		select max(score) as best
		from game
		where visitor_id = ${game.visitorId} and ${inMonth(game.council, game.finishedAt)}
			and finished_at <= ${histogram.asOf}
	`)!;
	let lower = histogram.counts.slice(0, game.score).reduce((sum, count) => sum + count, 0);
	let games = histogram.games;
	if (own.best !== null) {
		games -= 1;
		if (own.best < game.score) lower -= 1;
	}
	if (games < MIN_COMPARISON_GAMES) return null;

	// a game that finished before the counts but committed after them is not in them: the bounds
	// keep such a race from ever reading below 0 or above 100 %
	const percent = Math.floor((100 * Math.min(Math.max(lower, 0), games)) / games);
	return percent > 0 ? percent : null;
}

export async function gameSummary(
	db: Db,
	{
		gameId,
		visitorId,
		now = new Date(),
		histograms = shared
	}: { gameId: string; visitorId: string; now?: Date; histograms?: Histograms }
): Promise<GameSummary> {
	const game = db.get<{
		visitor_id: string | null;
		council: CouncilChoice;
		score: number;
		unranked: string | null;
		finished_at: number | null;
	}>(sql`
		select visitor_id, council, score, unranked, finished_at from game where id = ${gameId}
	`);
	if (!game || game.visitor_id !== visitorId) throw new GameRefusal(404, 'game.notFound');
	if (game.finished_at === null) throw new GameRefusal(409, 'game.stale');

	const device = db.get<{
		games: number;
		previous_best: number;
		average: number;
		previous_average: number | null;
	}>(sql`
		select count(*) as games,
			coalesce(max(score) filter (where id <> ${gameId}), -1) as previous_best,
			cast(round(avg(score)) as integer) as average,
			cast(round(avg(score) filter (where id <> ${gameId})) as integer) as previous_average
		from game
		where visitor_id = ${visitorId} and council = ${game.council}
			and finished_at <= ${game.finished_at}
	`)!;

	const ranked = {
		council: game.council,
		score: game.score,
		finishedAt: toDate(game.finished_at)!,
		visitorId
	};
	return {
		betterThan: game.unranked === null ? betterThan(db, histograms, ranked, now) : null,
		best: Math.max(game.score, device.previous_best),
		games: device.games,
		newBest: device.games > 1 && game.score > device.previous_best,
		average: device.average,
		previousAverage: device.previous_average
	};
}
