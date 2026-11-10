<script lang="ts">
	import type { CouncilChoice } from '$lib/game/protocol';
	import { translate, type Language } from '$lib/i18n';

	type Props = { language: Language; members: number };

	let { language, members }: Props = $props();

	const CHOICES: CouncilChoice[] = ['all', 'N', 'S'];

	let choice = $state<CouncilChoice>('all');
</script>

<div class="choice">
	<p id="council-label">{translate(language, 'home.council')}</p>
	<div class="options" role="group" aria-labelledby="council-label">
		{#each CHOICES as option (option)}
			<button type="button" aria-pressed={choice === option} onclick={() => (choice = option)}>
				{translate(language, `council.${option}`)}
			</button>
		{/each}
	</div>
	{#if members > 0}
		<a class="play" href="/{language}/game?council={choice}">{translate(language, 'home.play')}</a>
	{:else}
		<button class="play" type="button" disabled>{translate(language, 'home.play')}</button>
		<p class="no-data">{translate(language, 'home.noData')}</p>
	{/if}
</div>

<style>
	p {
		margin: 0 0 12px;
		font-weight: 700;
	}
	.options {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 24px;
	}
	.options button {
		min-height: 52px;
		padding: 8px 16px;
		font: inherit;
		font-weight: 700;
		color: var(--ink);
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: 14px;
		cursor: pointer;
		transition:
			background-color 100ms linear,
			border-color 0.3s var(--ease);
	}
	.options button[aria-pressed='true'] {
		color: var(--surface);
		background: var(--ink);
		border-color: var(--ink);
	}
	@media (hover: hover) {
		.options button[aria-pressed='false']:hover {
			background: var(--brand-soft);
			border-color: var(--brand);
		}
	}
	.play {
		display: block;
		box-sizing: border-box;
		width: 100%;
		padding: 16px;
		font: inherit;
		font-size: 20px;
		font-weight: 900;
		color: var(--ink);
		text-align: center;
		text-decoration: none;
		background: var(--brand);
		border: 0;
		border-radius: 14px;
		cursor: pointer;
	}
	.play:disabled {
		color: var(--muted);
		background: var(--rule);
		cursor: not-allowed;
	}
	.no-data {
		margin: 16px 0 0;
		font-weight: 400;
		color: var(--muted);
	}
	button:focus-visible,
	.play:focus-visible {
		outline: 3px solid var(--ink);
		outline-offset: 2px;
	}
	@media (min-width: 600px) {
		.options {
			flex-direction: row;
		}
		.options button {
			flex: 1;
		}
	}
	@media (hover: hover) {
		.play:not(:disabled):hover {
			background: var(--brand-hover);
		}
	}
</style>
