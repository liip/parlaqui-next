<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';
	import LiipLogo from '$lib/components/LiipLogo.svelte';
	import LanguageSwitch from '$lib/components/LanguageSwitch.svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { legacyHashLanguage, translate } from '$lib/i18n';
	import { trackInputModality } from '$lib/game/input-modality';

	let { children, data } = $props();

	$effect(trackInputModality);

	// links from the old site carried the language as #fr; the root redirect keeps the hash
	onMount(() => {
		const legacy = legacyHashLanguage(location.hash);
		if (legacy && legacy !== data.language) void goto(`/${legacy}`, { replaceState: true });
	});

	$effect(() => {
		document.documentElement.lang = data.language;
	});
</script>

<header class="mx-auto flex max-w-5xl items-start justify-between p-4">
	<a class="home" href="/{data.language}"><Logo /></a>
	<LanguageSwitch />
</header>

<main>
	{@render children()}
</main>

<footer class="footer mx-auto max-w-5xl p-4 text-sm">
	<span class="credit">
		{translate(data.language, 'footer.portraits')} ·
		<a href="/{data.language}/privacy">{translate(data.language, 'footer.privacy')}</a>
	</span>
	<span class="made">
		{translate(data.language, 'footer.madeBy')}
		<a class="liip" href="https://www.liip.ch" aria-label="Liip"><LiipLogo /></a>
	</span>
</footer>

<style>
	.footer {
		color: var(--muted);
		display: flex;
		align-items: baseline;
		justify-content: flex-end;
		gap: 6px;
	}
	.credit {
		margin-right: auto;
	}
	.made {
		display: inline-flex;
		flex-shrink: 0;
		align-items: baseline;
		gap: 6px;
		white-space: nowrap;
	}
	.credit a {
		color: inherit;
		text-decoration: underline;
	}
	.credit a:focus-visible {
		outline: 3px solid var(--ink);
		outline-offset: 2px;
	}
	.liip {
		display: inline-flex;
		color: var(--ink);
	}
	.liip :global(svg) {
		height: 16px;
		width: auto;
	}
	.home:focus-visible,
	.liip:focus-visible {
		outline: 3px solid var(--ink);
		outline-offset: 2px;
	}
	@media (max-width: 899px) and (max-height: 1000px) {
		header {
			padding-block: 8px;
		}
		.home,
		header :global(.logo) {
			display: block;
		}
		header :global(.logo svg) {
			width: 115px;
			height: 45px;
		}
		.footer {
			padding-block: 8px;
		}
	}
</style>
