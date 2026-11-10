<script lang="ts">
	import { onMount } from 'svelte';
	import Game from '$lib/components/Game.svelte';
	import GameOver from '$lib/components/GameOver.svelte';
	import { GameError, startGame } from '$lib/game/client';
	import { keyboardPlayer } from '$lib/game/input-modality';
	import type { CouncilChoice, StartedGame } from '$lib/game/protocol';
	import type { LoopState } from '$lib/game/round-loop';
	import { translate, type MessageKey } from '$lib/i18n';

	let { data } = $props();

	let game = $state<StartedGame | null>(null);
	let error = $state<MessageKey | null>(null);
	let result = $state<LoopState | null>(null);
	let newGame = $state<HTMLButtonElement>();

	const start = async (council: CouncilChoice) => {
		game = null;
		result = null;
		error = null;
		try {
			game = await startGame((...args) => fetch(...args), council, data.language);
		} catch (cause) {
			error = cause instanceof GameError ? cause.key : 'game.error';
		}
	};

	// the running game's council, not the address: a language switch on the way must not change it
	const again = () => start(game?.council ?? data.council);

	onMount(() => start(data.council));

	$effect(() => {
		if (error && newGame && keyboardPlayer()) newGame.focus({ preventScroll: true });
	});
</script>

<svelte:head>
	<title>{translate(data.language, result ? 'end.pageTitle' : 'game.pageTitle')}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#if error}
	<section class="status">
		<p role="alert">{translate(data.language, error)}</p>
		<button bind:this={newGame} type="button" onclick={again}
			>{translate(data.language, 'game.newGame')}</button
		>
		<a href="/{data.language}">{translate(data.language, 'game.back')}</a>
	</section>
{:else if result && game}
	<GameOver
		gameId={game.gameId}
		state={result}
		council={game.council}
		language={data.language}
		onagain={again}
	/>
{:else}
	{#key game}
		<Game
			{game}
			language={data.language}
			onend={(state) => (result = state)}
			onfail={(key) => (error = key)}
		/>
	{/key}
{/if}

<style>
	.status {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		max-width: 32rem;
		margin: 0 auto;
		padding: 24px 16px;
		text-align: center;
	}
	p {
		margin: 0;
	}
	button {
		width: 100%;
		padding: 14px;
		font: inherit;
		font-size: 18px;
		font-weight: 900;
		color: var(--ink);
		background: var(--brand);
		border: 0;
		border-radius: 14px;
		cursor: pointer;
	}
	a {
		color: var(--ink);
		text-decoration: underline;
	}
	button:focus-visible,
	a:focus-visible {
		outline: 3px solid var(--ink);
		outline-offset: 2px;
	}
	@media (hover: hover) {
		button:hover {
			background: var(--brand-hover);
		}
		a:hover {
			text-decoration-thickness: 2px;
		}
	}
</style>
