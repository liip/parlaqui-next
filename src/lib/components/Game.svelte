<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import Photo from '$lib/components/Photo.svelte';
	import RoundDots from '$lib/components/RoundDots.svelte';
	import { timeCallouts } from '$lib/game/callouts';
	import { createRoundLoop, initialState, type LoopState } from '$lib/game/round-loop';
	import { OPTIONS_PER_ROUND, ROUNDS_PER_GAME, type StartedGame } from '$lib/game/protocol';
	import { translate, type Language, type MessageKey } from '$lib/i18n';
	import { keyboardPlayer } from '$lib/game/input-modality';

	type Props = {
		game: StartedGame | null;
		language: Language;
		onend(state: LoopState): void;
		onfail(error: MessageKey): void;
	};

	let { game, language, onend, onfail }: Props = $props();

	const CHECKING_DELAY_MS = 600;
	const POSITIONS = [...Array(OPTIONS_PER_ROUND).keys()];

	// svelte-ignore state_referenced_locally
	let view = $state<LoopState>(
		game
			? initialState(game.round, game.total)
			: initialState({ index: 0, photoUrl: '' }, ROUNDS_PER_GAME)
	);
	let cards = $state<HTMLButtonElement[]>([]);
	let slow = $state(false);
	let callout = $state('');
	let ended = false;

	// svelte-ignore state_referenced_locally
	const loop =
		game &&
		createRoundLoop(game, {
			fetcher: (...args) => fetch(...args),
			onChange(next) {
				view = next;
				if (next.phase === 'failed') return onfail(next.error ?? 'game.error');
				if (next.phase !== 'finished' || ended) return;
				ended = true;
				onend(next);
			}
		});

	onDestroy(() => loop?.destroy());

	$effect(() => {
		slow = false;
		if (view.phase !== 'pending') return;
		const timer = setTimeout(() => (slow = true), CHECKING_DELAY_MS);
		return () => clearTimeout(timer);
	});

	const revealing = $derived(view.phase === 'revealing' && view.verdict !== null);
	const answerName = $derived(
		view.verdict ? `${view.verdict.answer.firstName} ${view.verdict.answer.lastName}` : ''
	);
	const status = $derived.by(() => {
		if (!game) return translate(language, 'game.preparing');
		if (revealing && view.verdict) {
			if (view.verdict.correct) {
				return translate(language, 'game.verdictRight', { points: view.verdict.points });
			}
			const key = view.chosenId === null ? 'game.verdictTimeout' : 'game.verdictWrong';
			return translate(language, key, { name: answerName });
		}
		if (view.phase === 'pending' && slow) return translate(language, 'game.checking');
		if (view.photoStatus === 'retrying') return translate(language, 'game.photoRetry');
		if (view.photoStatus === 'replacing') return translate(language, 'game.photoReplace');
		return '';
	});

	const cardClass = (id: number) => {
		if (!revealing) return id === view.chosenId ? 'chosen' : '';
		if (id === view.verdict?.answer.id) return view.verdict.correct ? 'correct winner' : 'correct';
		return id === view.chosenId ? 'wrong picked' : 'wrong';
	};

	const playingRound = $derived(view.phase === 'playing' ? view.index : null);

	// the buttons stay from round to round, so a screen reader's focus stays on its button
	$effect(() => {
		if (playingRound === null) return;
		void tick().then(() => {
			if (cards.includes(document.activeElement as HTMLButtonElement)) return;
			if (keyboardPlayer()) cards[0]?.focus({ preventScroll: true });
		});
	});

	$effect(() => {
		if (playingRound === null) return;
		const remainingMs = untrack(() => view.remainingMs);
		callout = translate(language, 'game.round', { n: playingRound + 1, total: view.total });
		const timers = timeCallouts(remainingMs).map(({ seconds, delayMs }) =>
			setTimeout(() => (callout = translate(language, 'game.secondsLeft', { seconds })), delayMs)
		);
		return () => timers.forEach(clearTimeout);
	});
</script>

{#if view.phase === 'finished'}
	<section class="failed">
		<p>{view.score}</p>
	</section>
{:else}
	<section class="board">
		<div class="face">
			<div class="portrait">
				<Photo
					url={view.photoUrl}
					alt={translate(language, 'game.portraitAlt')}
					phase={view.phase}
					remainingMs={view.remainingMs}
					onload={() => loop?.photoLoaded()}
					onerror={() => loop?.photoFailed()}
				/>
			</div>
			<div class="progress">
				<RoundDots
					points={view.points}
					index={view.index}
					total={view.total}
					score={view.score}
					{language}
				/>
			</div>
		</div>
		<div class="answers">
			<div class="prompt">
				<h2 class:covered={status !== ''}>{translate(language, 'game.question')}</h2>
				<p class="status" role="status">{status}</p>
				<p class="callout" role="status">{callout}</p>
			</div>
			<div
				class="cards"
				class:waiting={view.phase === 'pending'}
				aria-busy={view.phase === 'loading'}
			>
				{#each POSITIONS as position (position)}
					{@const option = view.options[position]}
					<!-- an inert button named only "preparing" while the photo loads: it reveals nothing and keeps the focus -->
					<button
						bind:this={cards[position]}
						type="button"
						class="card {option ? cardClass(option.id) : 'placeholder'}"
						aria-disabled={!option || view.phase !== 'playing'}
						aria-label={option ? undefined : translate(language, 'game.preparing')}
						onclick={() => option && loop?.choose(option.id)}
					>
						{#if option}
							<span class="name">{option.firstName} {option.lastName}</span>
							<span class="meta">
								<span class="party">{option.party}</span>
								<span class="marks">
									{#if revealing && option.id === view.verdict?.answer.id}
										<svg class="check" viewBox="0 0 12 12" aria-hidden="true">
											<path d="M2 6.5 5 9.5 10 3" />
										</svg>
									{/if}
									{#if option.id === view.chosenId}
										<span class="choice">{translate(language, 'game.yourChoice')}</span>
									{/if}
								</span>
							</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>
	</section>
{/if}

<style>
	section {
		max-width: 64rem;
		margin: 0 auto;
		padding: 0 16px;
		text-align: center;
	}
	.failed {
		padding-top: 24px;
	}
	.face {
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.portrait {
		display: flex;
		justify-content: center;
	}
	.prompt {
		display: grid;
		align-items: end;
		min-height: 45px;
		margin-bottom: 24px;
	}
	.prompt > * {
		grid-area: 1 / 1;
	}
	h2 {
		margin: 0;
		font-size: 22px;
		font-weight: 900;
		letter-spacing: -0.03em;
	}
	.covered {
		visibility: hidden;
	}
	.status {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		margin: 0;
		overflow: hidden;
		font-size: 18px;
		font-weight: 900;
		line-height: 1.25;
		letter-spacing: -0.02em;
	}
	.cards {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 1rem;
	}
	.card {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 2px;
		width: 100%;
		min-height: 64px;
		padding: 12px 16px;
		box-sizing: border-box;
		font-family: inherit;
		font-size: 16px;
		line-height: 1.25;
		color: var(--ink);
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: 14px;
		cursor: pointer;
		transition:
			background-color 100ms linear,
			border-color 0.3s var(--ease),
			transform 120ms var(--ease);
	}
	.name {
		font-weight: 700;
	}
	.meta {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		column-gap: 6px;
		align-items: center;
		font-size: 14px;
	}
	.party {
		grid-column: 2;
		color: var(--muted);
	}
	.marks {
		display: inline-flex;
		grid-column: 3;
		align-items: center;
		gap: 4px;
	}
	.check {
		width: 0.9em;
		height: 0.9em;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.choice {
		font-size: 12px;
		font-weight: 700;
		line-height: 1;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		white-space: nowrap;
	}
	@media (hover: hover) {
		button:hover:not(.correct):not(.wrong) {
			background: var(--brand-soft);
			border-color: var(--brand);
		}
	}
	button:active:not(.correct):not(.wrong) {
		transform: scale(0.97);
		background: var(--brand-soft);
	}
	button:focus-visible {
		outline: 3px solid var(--ink);
		outline-offset: 2px;
	}
	.placeholder {
		background: transparent;
		cursor: default;
	}
	.callout {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.waiting .card {
		cursor: progress;
	}
	.waiting .card:not(.chosen) {
		opacity: 0.55;
	}
	.chosen {
		border-color: var(--ink);
		box-shadow: inset 0 0 0 1px var(--ink);
	}
	.wrong {
		background: transparent;
		border-color: var(--rule);
	}
	.wrong .name {
		color: var(--muted);
	}
	.picked {
		border-color: var(--ink);
		animation: shake 0.82s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
	}
	.correct {
		background: var(--brand);
		border-color: var(--brand);
	}
	.correct .party {
		color: var(--ink);
	}
	@keyframes shake {
		10%,
		90% {
			transform: translate3d(-1px, 0, 0);
		}
		20%,
		80% {
			transform: translate3d(2px, 0, 0);
		}
		30%,
		50%,
		70% {
			transform: translate3d(-4px, 0, 0);
		}
		40%,
		60% {
			transform: translate3d(4px, 0, 0);
		}
	}
	.winner {
		animation: halo 1s linear;
	}
	@keyframes halo {
		from {
			box-shadow: 0 0 0 0 color-mix(in srgb, var(--brand) 40%, transparent);
		}
		to {
			box-shadow: 0 0 0 24px transparent;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.picked,
		.winner {
			animation: none;
		}
		button:active:not(.correct):not(.wrong) {
			transform: none;
		}
	}
	@media (max-width: 899px) and (max-height: 1000px) {
		.prompt {
			min-height: 39px;
			margin-bottom: 8px;
		}
		h2 {
			font-size: 18px;
			line-height: 1.2;
		}
		.status {
			font-size: 16px;
			line-height: 1.2;
		}
		.cards {
			gap: 6px;
			margin-bottom: 0;
		}
		.card {
			min-height: 48px;
			padding: 4px 14px;
			font-size: 15px;
			line-height: 1.2;
			gap: 0;
		}
		.meta {
			font-size: 12px;
		}
	}
	/* a phone: the portrait keeps its room and the six answers go in two columns */
	@media (max-width: 899px) and (max-height: 760px) {
		/* room for a two-line verdict, so the cards do not move when it shows */
		.prompt {
			min-height: 34px;
			margin-bottom: 6px;
		}
		.status {
			font-size: 14px;
		}
		.cards {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 6px;
		}
		.card {
			min-height: 52px;
			padding: 4px 8px;
			overflow-wrap: anywhere;
		}
		/* no room for the label beside the party: the border and the check show the choice */
		.choice {
			position: absolute;
			width: 1px;
			height: 1px;
			margin: -1px;
			overflow: hidden;
			clip-path: inset(50%);
		}
	}
	@media (max-width: 389px) and (max-height: 760px) {
		.card {
			font-size: 14px;
			line-height: 1.15;
		}
	}
	@media (min-width: 900px) {
		section {
			display: grid;
			grid-template-columns: 280px minmax(0, 1fr);
			text-align: left;
		}
		.failed {
			display: block;
		}
		.answers {
			padding-left: 56px;
			border-left: 1px solid var(--rule);
		}
		.cards {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 14px;
			margin-bottom: 0;
		}
		.prompt {
			align-items: start;
			min-height: 50px;
		}
		.status {
			font-size: 20px;
		}
		.card {
			min-height: 76px;
			font-size: 19px;
		}
		.meta {
			font-size: 15px;
		}
	}
	/* a phone on its side or a page zoomed to 200 %: the six answers beside the portrait */
	@media (max-height: 500px) and (min-width: 560px) {
		.board {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr);
			column-gap: 16px;
			align-items: start;
			text-align: left;
		}
		.answers {
			padding-left: 16px;
			border-left: 1px solid var(--rule);
		}
		.prompt {
			min-height: 34px;
			margin-bottom: 6px;
		}
		h2 {
			font-size: 18px;
		}
		.status {
			font-size: 14px;
			line-height: 1.2;
		}
		.cards {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 6px;
			margin: 0;
		}
		.card {
			min-height: 44px;
			padding: 4px 10px;
			font-size: 14px;
			line-height: 1.15;
			gap: 0;
			overflow-wrap: anywhere;
		}
		.meta {
			font-size: 12px;
		}
	}
</style>
