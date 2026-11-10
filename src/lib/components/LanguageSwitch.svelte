<script lang="ts">
	import { page } from '$app/state';
	import { LANGUAGES, switchPath, translate } from '$lib/i18n';

	let current = $derived(page.data.language);
</script>

<nav class="lang" aria-label={translate(current, 'language.label')}>
	{#each LANGUAGES as code (code)}
		<a
			href={switchPath(page.url, code)}
			class:active={code === current}
			aria-current={code === current ? 'page' : undefined}
			hreflang={code}
			lang={code}
			aria-label={translate(code, `language.${code}`)}
			title={translate(code, `language.${code}`)}>{code.toUpperCase()}</a
		>
	{/each}
</nav>

<style>
	.lang {
		display: flex;
		gap: 0;
		font-size: 11px;
		letter-spacing: 0.06em;
		color: var(--muted);
	}
	a {
		display: inline-block;
		min-width: 40px;
		min-height: 44px;
		line-height: 44px;
		text-align: center;
	}
	.active {
		font-weight: 700;
		color: var(--ink);
		text-decoration: underline;
		text-decoration-color: var(--brand);
		text-decoration-thickness: 2px;
	}
	@media (hover: hover) {
		a:not(.active):hover {
			color: var(--ink);
		}
	}
</style>
