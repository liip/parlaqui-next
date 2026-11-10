import { OPTIONS_PER_ROUND } from '$lib/game/protocol';
import { randomCrop, type Crop } from '../photo/variant';

export type Candidate = { id: number; gender: 'f' | 'm'; photoCode: string };

export type DealtRound = {
	memberId: number;
	optionIds: number[];
	photoCode: string;
	crop: Crop;
};

type Random = () => number;

function pickOne<T>(items: T[], random: Random): T {
	return items[Math.floor(random() * items.length)];
}

function shuffle<T>(items: T[], random: Random): T[] {
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

export function dealRounds(
	pool: Candidate[],
	count: number,
	{
		exclude = new Set<number>(),
		earlierAnswers = new Set<number>(),
		random = Math.random
	}: { exclude?: Set<number>; earlierAnswers?: Set<number>; random?: Random } = {}
): DealtRound[] {
	const byGender = new Map<Candidate['gender'], Candidate[]>();
	for (const candidate of pool) {
		byGender.set(candidate.gender, [...(byGender.get(candidate.gender) ?? []), candidate]);
	}

	const answers: Candidate[] = [];
	const asked = new Set<number>();
	while (answers.length < count) {
		const eligible = pool.filter(
			(candidate) =>
				(byGender.get(candidate.gender)?.length ?? 0) >= OPTIONS_PER_ROUND &&
				!exclude.has(candidate.id) &&
				!asked.has(candidate.id)
		);
		if (eligible.length === 0) break;

		const answer = pickOne(eligible, random);
		asked.add(answer.id);
		answers.push(answer);
	}

	return answers.map((answer, index): DealtRound => {
		const others = (byGender.get(answer.gender) ?? []).filter((c) => c.id !== answer.id);
		// an earlier answer could only be a wrong option; a later one is shown as freely as anyone
		const earlier = new Set([...earlierAnswers, ...answers.slice(0, index).map((c) => c.id)]);
		const fresh = others.filter((c) => !earlier.has(c.id));
		const pick = fresh.length >= OPTIONS_PER_ROUND - 1 ? fresh : others;
		const distractors = shuffle(pick, random).slice(0, OPTIONS_PER_ROUND - 1);

		return {
			memberId: answer.id,
			optionIds: shuffle([answer.id, ...distractors.map((c) => c.id)], random),
			photoCode: answer.photoCode,
			crop: randomCrop(random)
		};
	});
}
