<script lang="ts">
	let { form } = $props();
</script>

<svelte:head>
	<title>Audience · Parlaqui</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main>
	<h1>Audience</h1>
	<form method="POST">
		<label for="token">Jeton (INSIGHTS_TOKEN)</label>
		<input id="token" name="token" type="password" autocomplete="current-password" required />
		<button type="submit">Ouvrir</button>
		{#if form?.wrong}
			<p role="alert">Ce jeton ne correspond pas.</p>
		{/if}
	</form>
</main>

<style>
	main {
		max-width: 24rem;
		margin: 0 auto;
		padding: 32px 16px;
	}
	h1 {
		margin: 0 0 16px;
		font-size: 30px;
		font-weight: 900;
	}
	form {
		display: grid;
		gap: 8px;
	}
	input,
	button {
		padding: 12px;
		font: inherit;
		border: 1px solid var(--rule);
		border-radius: 12px;
	}
	button {
		font-weight: 900;
		background: var(--brand);
		border-color: var(--brand);
		cursor: pointer;
	}
	button:focus-visible,
	input:focus-visible {
		outline: 3px solid var(--ink);
		outline-offset: 2px;
	}
	@media (hover: hover) {
		button:hover {
			background: var(--brand-hover);
			border-color: var(--brand-hover);
		}
	}
</style>
