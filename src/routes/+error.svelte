<script lang="ts">
	import { page } from '$app/state';
	import Logo from '$lib/components/Logo.svelte';
	import { isLanguage, translate } from '$lib/i18n';

	// a broken share link or a typo lands here, often before any layout knew the language
	const first = $derived(page.url.pathname.split('/')[1]);
	const language = $derived(isLanguage(first) ? first : 'de');
</script>

<header class="mx-auto max-w-5xl p-4">
	<a class="home" href="/{language}"><Logo /></a>
</header>

<main class="mx-auto max-w-5xl p-4">
	<h1>
		{translate(language, page.status === 404 ? 'error.notFound' : 'game.error')}
	</h1>
	<p><a href="/{language}">{translate(language, 'game.back')}</a></p>
</main>

<style>
	h1 {
		margin: 24px 0 16px;
		font-size: 28px;
		font-weight: 900;
		letter-spacing: -0.03em;
	}
	a {
		color: inherit;
	}
	a:focus-visible {
		outline: 3px solid var(--ink);
		outline-offset: 2px;
	}
</style>
