<script lang="ts">
	import { onMount } from 'svelte';
	import { fetchSummary, shareScore } from '$lib/game/client';
	import ShareSheet, { type Shareable } from './ShareSheet.svelte';
	import { MAX_POINTS_PER_ROUND, type CouncilChoice, type GameSummary } from '$lib/game/protocol';
	import type { LoopState } from '$lib/game/round-loop';
	import { translate, type Language } from '$lib/i18n';

	type Props = {
		gameId: string;
		state: LoopState;
		council: CouncilChoice;
		language: Language;
		onagain(): void;
	};

	let { gameId, state: game, council, language, onagain }: Props = $props();

	let heading: HTMLHeadingElement;
	let summary = $state<GameSummary | null>(null);
	let summaryLoaded = $state(false);
	const maxScore = $derived(game.total * MAX_POINTS_PER_ROUND);
	const councilName = $derived(
		translate(language, council === 'all' ? 'end.councilAll' : `council.${council}`)
	);

	const fetcher: typeof fetch = (...args) => fetch(...args);

	const versusSelf = $derived.by(() => {
		const previous = summary?.previousAverage;
		if (previous == null || !summary) return null;
		const diff = game.score - previous;
		if (diff === 0) return translate(language, 'end.sameAsAverage', { average: previous });
		const signed = diff > 0 ? `+${diff}` : `\u2212${-diff}`;
		const key = summary.games === 2 ? 'end.vsPrevious' : 'end.vsAverage';
		return translate(language, key, { diff: signed, average: previous });
	});

	let sheet: ShareSheet;

	// ready before the tap: iOS opens the share sheet only right after it
	const prepare = async (lang: Language): Promise<Shareable | null> => {
		const token = await shareScore(fetcher, gameId);
		if (!token) return null;
		const page = `${location.origin}/${lang}/s/${token}`;
		let file: File | null = null;
		try {
			const image = await fetch(`${page}/story.jpg`, { signal: AbortSignal.timeout(8_000) });
			if (image.ok) file = new File([await image.blob()], 'parlaqui.jpg', { type: 'image/jpeg' });
		} catch {
			file = null;
		}
		return { story: `${page}/story.jpg`, file };
	};
	let ready = $state<Promise<Shareable | null>>(new Promise(() => {}));

	onMount(() => {
		heading.focus({ preventScroll: true });
		void fetchSummary(fetcher, gameId).then((answer) => {
			summary = answer;
			summaryLoaded = true;
		});
	});

	// again on a language switch, which keeps this component: the image is drawn in the language
	$effect(() => {
		ready = prepare(language);
	});
</script>

<section>
	<h1 bind:this={heading} tabindex="-1">
		{translate(language, 'end.title', { council: councilName })}
	</h1>
	<p class="score">
		<span class="value">{game.score}</span>
		<span class="unit">
			{translate(language, 'end.outOf', { max: maxScore })}
		</span>
	</p>
	<div class="standing" aria-live="polite">
		{#if summary?.newBest}
			<p>{translate(language, 'end.newBest')}</p>
		{/if}
		{#if summary?.betterThan}
			<p>{translate(language, 'end.betterThan', { percent: summary.betterThan })}</p>
		{/if}
		{#if summaryLoaded && !summary?.newBest && !summary?.betterThan}
			{#if game.score === maxScore}
				<p>{translate(language, 'end.perfect')}</p>
			{:else if game.score >= 2}
				<p>{translate(language, 'end.beat', { score: game.score })}</p>
			{/if}
		{/if}
		{#if versusSelf}
			<p class="self">{versusSelf}</p>
		{/if}
	</div>
	<p class="correct">
		<span>{translate(language, 'end.correct')}</span>
		<strong>
			{translate(language, 'end.correctOf', {
				correct: game.correctCount,
				total: game.total
			})}
		</strong>
	</p>
	<button type="button" onclick={onagain}>{translate(language, 'end.again')}</button>
	<button type="button" class="share" onclick={() => sheet.open()}>
		{translate(language, 'share.button')}
	</button>
	<ShareSheet bind:this={sheet} {language} {ready} onretry={() => (ready = prepare(language))} />
	<a class="council" href="/{language}">{translate(language, 'end.changeCouncil')}</a>
	{#if summary && summary.games > 1}
		<h2 class="device-title">
			{translate(language, 'end.deviceTitle', { council: councilName })}
		</h2>
		<dl class="device">
			<div>
				<dt>{translate(language, 'end.best')}</dt>
				<dd>{summary.best}</dd>
			</div>
			<div>
				<dt>{translate(language, 'end.average')}</dt>
				<dd>{summary.average}</dd>
			</div>
			<div>
				<dt>{translate(language, 'end.games')}</dt>
				<dd>{summary.games}</dd>
			</div>
		</dl>
	{/if}
	{#if game.missed.length > 0}
		<h2>{translate(language, 'end.missed')}</h2>
		<ul>
			{#each game.missed as person (person.photoUrl)}
				<li>
					<img src={person.photoUrl} alt="" />
					<span class="name">{person.firstName} {person.lastName}</span>
					<span class="meta">{person.party} · {person.canton}</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	section {
		max-width: 40rem;
		margin: 0 auto;
		padding: 24px 16px 32px;
		text-align: center;
	}
	h1 {
		margin: 0 0 16px;
		font-size: 20px;
		font-weight: 900;
		letter-spacing: -0.03em;
	}
	p {
		margin: 0;
	}
	h1:focus-visible {
		outline: 3px solid var(--ink);
		outline-offset: 2px;
	}
	.score {
		display: flex;
		justify-content: center;
		align-items: baseline;
		gap: 8px;
		margin-bottom: 16px;
	}
	.value {
		font-size: 64px;
		font-weight: 900;
		line-height: 1;
		letter-spacing: -0.05em;
	}
	.unit {
		color: var(--muted);
	}
	.standing {
		min-height: 3em;
		margin: -8px 0 12px;
		font-weight: 700;
		line-height: 1.5;
	}
	.self {
		font-weight: 500;
		color: var(--muted);
	}
	.share {
		margin-top: 12px;
		padding: 12px;
		font-size: 17px;
		background: var(--surface);
		border: 1px solid var(--rule);
	}
	.device-title {
		margin: 20px 0 0;
		font-size: 14px;
		font-weight: 700;
		color: var(--muted);
		text-align: left;
	}
	.device {
		margin: 4px 0 0;
		text-align: left;
	}
	.device div {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 0;
		border-bottom: 1px solid var(--rule);
	}
	.device dt {
		color: var(--muted);
	}
	.device dd {
		margin: 0;
		font-weight: 700;
	}
	.correct {
		display: flex;
		justify-content: space-between;
		padding: 12px 0;
		border-top: 1px solid var(--rule);
		border-bottom: 1px solid var(--rule);
	}
	h2 {
		margin: 24px 0 12px;
		font-size: 16px;
		font-weight: 900;
		text-align: left;
	}
	ul {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 16px 12px;
		padding: 0;
		margin: 0 0 24px;
		list-style: none;
	}
	li {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	img {
		width: 88px;
		height: 88px;
		margin-bottom: 6px;
		object-fit: cover;
		background: var(--rule);
		border-radius: 50%;
	}
	.name {
		font-weight: 700;
	}
	.meta {
		font-size: 14px;
		color: var(--muted);
	}
	button {
		width: 100%;
		margin-top: 20px;
		padding: 16px;
		font: inherit;
		font-size: 20px;
		font-weight: 900;
		color: var(--ink);
		background: var(--brand);
		border: 0;
		border-radius: 14px;
		cursor: pointer;
	}
	.council {
		display: inline-block;
		margin-top: 12px;
		padding: 8px;
		color: var(--ink);
		text-decoration: underline;
	}
	@media (min-width: 480px) {
		ul {
			grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		}
	}
	button:focus-visible,
	.council:focus-visible {
		outline: 3px solid var(--ink);
		outline-offset: 2px;
	}
	@media (hover: hover) {
		button:hover {
			background: var(--brand-hover);
		}
		.share:hover {
			background: var(--brand-soft);
			border-color: var(--brand);
		}
		.council:hover {
			text-decoration-thickness: 2px;
		}
	}
</style>
