<script lang="ts">
	import { privacy } from '$lib/privacy';
	import { alternates, pageUrl } from '$lib/seo';

	let { data } = $props();

	const text = $derived(privacy[data.language]);
</script>

<svelte:head>
	<title>{text.title} · Parlaqui</title>
	<meta name="description" content={text.intro} />
	<link rel="canonical" href={pageUrl(data.language, '/privacy')} />
	{#each alternates('/privacy') as alternate (alternate.hreflang)}
		<link rel="alternate" hreflang={alternate.hreflang} href={alternate.href} />
	{/each}
</svelte:head>

<article>
	<h1>{text.title}</h1>
	<p class="intro">{text.intro}</p>
	{#each text.sections as section (section.title)}
		<h2>{section.title}</h2>
		{#each section.paragraphs as paragraph (paragraph)}
			<p>{paragraph}</p>
		{/each}
	{/each}
	<p class="updated">{text.updated}</p>
</article>

<style>
	article {
		max-width: 40rem;
		margin: 0 auto;
		padding: 32px 16px;
		line-height: 1.55;
	}
	h1 {
		margin: 0 0 12px;
		font-size: 30px;
		font-weight: 900;
		letter-spacing: -0.03em;
	}
	.intro {
		font-size: 17px;
	}
	h2 {
		margin: 28px 0 8px;
		font-size: 18px;
		font-weight: 900;
	}
	p {
		margin: 0 0 10px;
	}
	.updated {
		margin-top: 28px;
		font-size: 14px;
		color: var(--muted);
	}
</style>
