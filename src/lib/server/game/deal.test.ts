import { describe, expect, it } from 'vitest';
import { OPTIONS_PER_ROUND, ROUNDS_PER_GAME } from '$lib/game/protocol';
import { dealRounds, type Candidate } from './deal';

function seeded(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
}

function pool(female: number, male: number): Candidate[] {
	return [
		...Array.from({ length: female }, (_, i) => ({
			id: 1 + i,
			gender: 'f' as const,
			photoCode: `f${i}`
		})),
		...Array.from({ length: male }, (_, i) => ({
			id: 1000 + i,
			gender: 'm' as const,
			photoCode: `m${i}`
		}))
	];
}

describe('dealRounds', () => {
	it('deals ten rounds with six distinct options including the answer', () => {
		const rounds = dealRounds(pool(15, 15), ROUNDS_PER_GAME, { random: seeded(1) });

		expect(rounds).toHaveLength(10);
		for (const round of rounds) {
			expect(round.optionIds).toHaveLength(OPTIONS_PER_ROUND);
			expect(new Set(round.optionIds).size).toBe(OPTIONS_PER_ROUND);
			expect(round.optionIds).toContain(round.memberId);
		}
	});

	it("options share the answer's gender", () => {
		const candidates = pool(15, 15);
		const genderOf = new Map(candidates.map((c) => [c.id, c.gender]));

		const rounds = dealRounds(candidates, ROUNDS_PER_GAME, { random: seeded(2) });

		for (const round of rounds) {
			const expected = genderOf.get(round.memberId);
			expect(round.optionIds.map((id) => genderOf.get(id))).toEqual(
				Array(OPTIONS_PER_ROUND).fill(expected)
			);
		}
	});

	it('carries the answer photo code and a crop', () => {
		const candidates = pool(15, 15);
		const [round] = dealRounds(candidates, 1, { random: seeded(3) });

		expect(round.photoCode).toBe(candidates.find((c) => c.id === round.memberId)?.photoCode);
		expect(round.crop.size).toBeGreaterThanOrEqual(0.9);
		expect(round.crop.size).toBeLessThanOrEqual(0.97);
	});

	it('never asks the same person twice', () => {
		const rounds = dealRounds(pool(15, 15), ROUNDS_PER_GAME, { random: seeded(4) });

		expect(new Set(rounds.map((r) => r.memberId)).size).toBe(10);
	});

	it('skips a gender with fewer than six members', () => {
		const rounds = dealRounds(pool(5, 20), ROUNDS_PER_GAME, { random: seeded(5) });

		expect(rounds).toHaveLength(10);
		expect(rounds.every((r) => r.memberId >= 1000)).toBe(true);
	});

	it('deals fewer rounds when the pool runs out', () => {
		expect(dealRounds(pool(0, 7), ROUNDS_PER_GAME, { random: seeded(6) })).toHaveLength(7);
	});

	it('respects exclude', () => {
		const candidates = pool(15, 15);
		const others = candidates.slice(0, 5).map((c) => c.id);
		const exclude = new Set(candidates.slice(5).map((c) => c.id));

		const rounds = dealRounds(candidates, ROUNDS_PER_GAME, { exclude, random: seeded(7) });

		expect(rounds.map((r) => r.memberId).sort((a, b) => a - b)).toEqual(others);
	});

	it('returns no rounds when no gender has six members', () => {
		expect(dealRounds(pool(5, 5), ROUNDS_PER_GAME, { random: seeded(8) })).toEqual([]);
	});

	it('the answer is not always the first option', () => {
		const positions = new Set<number>();
		for (let i = 0; i < 50; i++) {
			const [round] = dealRounds(pool(15, 15), 1, { random: Math.random });
			positions.add(round.optionIds.indexOf(round.memberId));
		}

		expect(positions.size).toBeGreaterThan(1);
	});

	it('an earlier answer is never a later distractor while the pool allows it', () => {
		const rounds = dealRounds(pool(15, 15), ROUNDS_PER_GAME, { random: seeded(9) });

		for (const [index, round] of rounds.entries()) {
			const earlier = new Set(rounds.slice(0, index).map((r) => r.memberId));
			expect(round.optionIds.filter((id) => earlier.has(id))).toEqual([]);
		}
	});

	it("a later round's answer may be an earlier round's distractor", () => {
		const leaksLater = (seed: number) => {
			const rounds = dealRounds(pool(15, 15), ROUNDS_PER_GAME, { random: seeded(seed) });
			return rounds.some((round, index) =>
				rounds.slice(index + 1).some((later) => round.optionIds.includes(later.memberId))
			);
		};

		expect([1, 2, 3, 4, 5].some(leaksLater)).toBe(true);
	});

	it('ruling out the names already seen as options does not find the answer', () => {
		const random = seeded(12);
		let hits = 0;
		let expected = 0;
		for (let game = 0; game < 2_000; game++) {
			const seen = new Set<number>();
			for (const round of dealRounds(pool(15, 15), ROUNDS_PER_GAME, { random })) {
				const unseen = round.optionIds.filter((id) => !seen.has(id));
				if (unseen.length > 0 && unseen.length < OPTIONS_PER_ROUND) {
					expected += unseen.length / OPTIONS_PER_ROUND;
					if (unseen.includes(round.memberId)) hits += 1;
				}
				round.optionIds.forEach((id) => seen.add(id));
			}
		}

		// a blind guess among the unseen names hits as often as chance, within a generous margin
		expect(hits / expected).toBeGreaterThan(0.95);
		expect(hits / expected).toBeLessThan(1.05);
	});

	it('a replacement round leaves out every dealt answer but only the earlier ones as options', () => {
		const candidates = pool(15, 0);
		const dealt = new Set(candidates.slice(0, 10).map((c) => c.id));
		const earlierAnswers = new Set(candidates.slice(0, 3).map((c) => c.id));

		const replacements = Array.from({ length: 50 }, (_, seed) => {
			const [round] = dealRounds(candidates, 1, {
				exclude: dealt,
				earlierAnswers,
				random: seeded(seed)
			});
			return round;
		});

		for (const round of replacements) {
			expect(dealt.has(round.memberId)).toBe(false);
			expect(round.optionIds.filter((id) => earlierAnswers.has(id))).toEqual([]);
		}
		const later = replacements.flatMap((r) => r.optionIds).filter((id) => dealt.has(id));
		expect(later.length).toBeGreaterThan(0);
	});

	it('falls back to earlier answers as distractors when the pool is too small', () => {
		const rounds = dealRounds(pool(0, 7), ROUNDS_PER_GAME, { random: seeded(11) });

		for (const round of rounds) {
			expect(new Set(round.optionIds).size).toBe(OPTIONS_PER_ROUND);
		}
	});
});
