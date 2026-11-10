export const ROUNDS_PER_GAME = 10;
export const OPTIONS_PER_ROUND = 6;
export const ROUND_MS = 10_000;
export const MAX_POINTS_PER_ROUND = 10;
export const RESULT_MS = { right: 1_000, wrong: 3_000 };

export type CouncilChoice = 'all' | 'N' | 'S';

const COUNCIL_CHOICES: readonly unknown[] = ['all', 'N', 'S'];

export const isCouncilChoice = (value: unknown): value is CouncilChoice =>
	COUNCIL_CHOICES.includes(value);

export type PublicRound = { index: number; photoUrl: string };

export type PublicOption = { id: number; firstName: string; lastName: string; party: string };

export type StartedGame = {
	gameId: string;
	total: number;
	council: CouncilChoice;
	round: PublicRound;
};

// deadline and serverNow are epoch ms on the server's clock;
// remainingMs only serves browsers still running the previous bundle during a deploy
export type OpenRound = {
	index: number;
	options: PublicOption[];
	deadline: number;
	serverNow: number;
	remainingMs: number;
};

export type ReplacedRound = { replaced: true; round: PublicRound };

export type Revealed = PublicOption & { canton: string };

export type Verdict = {
	index: number;
	correct: boolean;
	answer: Revealed;
	points: number;
	score: number;
	correctCount: number;
	next: PublicRound | null;
	finished: boolean;
	revealMs: number;
};

export type GameSummary = {
	betterThan: number | null;
	best: number;
	games: number;
	newBest: boolean;
	// all over this visitor's games of the same council, up to this one
	average: number;
	// the mean before this game, null on a first game of that council
	previousAverage: number | null;
};
