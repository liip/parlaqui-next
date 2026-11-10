<script lang="ts">
	import { isOne, translate, type Language } from '$lib/i18n';

	type Props = {
		points: (number | null)[];
		index: number;
		total: number;
		score: number;
		language: Language;
	};

	let { points, index, total, score, language }: Props = $props();

	const stateOf = (position: number) => {
		const value = points[position];
		if (value === undefined) return 'open';
		return value !== null && value > 0 ? 'scored' : 'missed';
	};
</script>

<div class="dots" aria-hidden="true">
	{#each [...Array(total).keys()] as position (position)}
		<div class="dot {stateOf(position)}" class:current={position === index}>
			{position !== index && (points[position] ?? 0) > 0 ? points[position] : ''}
		</div>
	{/each}
</div>
<p class="where">
	{translate(language, 'game.round', { n: index + 1, total })} ·
	{translate(language, isOne(language, score) ? 'game.scoreOne' : 'game.score', { score })}
</p>

<style>
	.dots {
		display: flex;
		justify-content: center;
		flex-wrap: wrap;
		margin-bottom: 0.4rem;
	}
	.dot {
		width: 1.2rem;
		height: 1.2rem;
		margin: 0.2rem;
		font-size: small;
		line-height: 1rem;
		text-align: center;
		background: transparent;
		border: 1px solid var(--muted);
		border-radius: 50%;
		transition: background-color 250ms linear;
	}
	.scored {
		color: var(--ink);
		background: var(--brand);
		border-color: var(--brand);
	}
	.missed {
		color: transparent;
		background: var(--muted);
		border-color: var(--muted);
	}
	.current {
		border: 2px solid var(--ink);
	}
	.current.scored {
		border-color: var(--brand);
	}
	.current.missed {
		border-color: var(--muted);
	}
	.where {
		margin: 0 0 1rem;
		font-size: 12px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		text-align: center;
		color: var(--muted);
	}
	@media (max-width: 899px) and (max-height: 1000px) {
		.dots {
			gap: 3px;
			margin-bottom: 4px;
		}
		.dot {
			width: 16px;
			height: 16px;
			margin: 0;
			font-size: 12px;
			line-height: 14px;
		}
		.where {
			margin-bottom: 10px;
			line-height: 1.2;
		}
	}
	@media (max-width: 359px) {
		.dots {
			display: grid;
			grid-template-columns: repeat(5, 16px);
			gap: 3px;
		}
	}
	@media (max-height: 500px) and (min-width: 560px) {
		.dots {
			gap: 2px;
			margin-bottom: 4px;
		}
		.dot {
			width: 16px;
			height: 16px;
			margin: 0;
			font-size: 12px;
			line-height: 14px;
		}
		.where {
			margin: 0;
			font-size: 12px;
			line-height: 1.3;
		}
	}
</style>
