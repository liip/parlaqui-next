<script lang="ts">
	import DataSource from '$lib/components/DataSource.svelte';
	import { translate } from '$lib/i18n';
	import { OG_IMAGE, OG_LOCALES, alternates, pageUrl } from '$lib/seo';

	let { data } = $props();

	const title = $derived(translate(data.language, 'members.title', { members: data.total }));
	const description = $derived(translate(data.language, 'members.description'));
	const url = $derived(pageUrl(data.language, '/members'));
</script>

<svelte:head>
	<title>{title} · Parlaqui</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={url} />
	{#each alternates('/members') as alternate (alternate.hreflang)}
		<link rel="alternate" hreflang={alternate.hreflang} href={alternate.href} />
	{/each}
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Parlaqui" />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={url} />
	<meta property="og:locale" content={OG_LOCALES[data.language]} />
	<meta property="og:image" content={OG_IMAGE.url} />
	<meta property="og:image:width" content={String(OG_IMAGE.width)} />
	<meta property="og:image:height" content={String(OG_IMAGE.height)} />
	<meta property="og:image:alt" content={translate(data.language, 'seo.imageAlt')} />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<section>
	<h1>{title}</h1>
	<p class="intro">{description}</p>
	<p class="intro">
		{translate(data.language, 'about.who')}
		{translate(data.language, 'footer.portraits')}.
	</p>
	<DataSource language={data.language} asOf={data.asOf} />
	{#if data.stale}
		<p class="intro" role="status">{translate(data.language, 'home.stale')}</p>
	{/if}
	<p class="challenge">{translate(data.language, 'members.challenge')}</p>
	<a class="play" href="/{data.language}">{translate(data.language, 'home.play')}</a>

	<nav aria-label={translate(data.language, 'members.councils')}>
		{#each data.councils as council (council.council)}
			<a href="#council-{council.council}">
				{translate(data.language, `council.${council.council}`)}
				<span>{council.count}</span>
			</a>
		{/each}
	</nav>

	{#each data.councils as council (council.council)}
		<h2 id="council-{council.council}">
			{translate(data.language, `council.${council.council}`)}
			<span>{translate(data.language, 'members.count', { count: council.count })}</span>
		</h2>
		{#each council.cantons as canton (canton.code)}
			<h3 id="council-{council.council}-{canton.code}">{canton.name}</h3>
			<ul>
				{#each canton.members as member (member.id)}
					<li>
						{#if member.hasPhoto}
							<img
								src="/portrait/{member.id}"
								alt=""
								width="48"
								height="48"
								loading="lazy"
								decoding="async"
							/>
						{:else}
							<span class="blank" aria-hidden="true"></span>
						{/if}
						<span class="name">{member.firstName} {member.lastName}</span>
						<span class="party">{member.party}</span>
					</li>
				{/each}
			</ul>
		{/each}
	{/each}
</section>

<style>
	section {
		max-width: 40rem;
		margin: 0 auto;
		padding: 32px 16px;
	}
	h1 {
		margin: 0 0 12px;
		font-size: 30px;
		font-weight: 900;
		line-height: 1.1;
		letter-spacing: -0.03em;
	}
	.intro {
		margin: 0 0 16px;
		color: var(--muted);
		line-height: 1.5;
	}
	.challenge {
		margin: 0 0 12px;
		font-weight: 700;
	}
	.play {
		display: block;
		padding: 14px;
		border-radius: 12px;
		background: var(--brand);
		color: var(--ink);
		font-size: 20px;
		font-weight: 900;
		text-align: center;
		text-decoration: none;
	}
	.play:focus-visible {
		outline: 3px solid var(--ink);
		outline-offset: 2px;
	}
	nav {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		gap: 8px;
		margin: 24px -16px 0;
		padding: 10px 16px;
		background: var(--paper);
		border-bottom: 1px solid var(--rule);
	}
	nav a {
		flex: 1;
		padding: 10px 8px;
		border: 1px solid var(--rule);
		border-radius: 12px;
		background: var(--surface);
		color: var(--ink);
		font-weight: 700;
		text-align: center;
		text-decoration: none;
	}
	nav a span {
		font-weight: 500;
		color: var(--muted);
	}
	nav a:focus-visible {
		outline: 3px solid var(--ink);
		outline-offset: 2px;
	}
	h2 {
		scroll-margin-top: 72px;
		margin: 40px 0 0;
		padding-bottom: 8px;
		border-bottom: 1px solid var(--rule);
		font-size: 22px;
		font-weight: 900;
	}
	h2 span {
		font-size: 15px;
		font-weight: 500;
		color: var(--muted);
	}
	h3 {
		scroll-margin-top: 72px;
		margin: 20px 0 6px;
		font-size: 16px;
		font-weight: 900;
	}
	ul {
		display: grid;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: grid;
		grid-template-columns: 48px 1fr;
		grid-template-rows: auto auto;
		column-gap: 12px;
		align-items: center;
	}
	img,
	.blank {
		grid-row: 1 / 3;
		width: 48px;
		height: 48px;
		border-radius: 50%;
		object-fit: cover;
		background: var(--rule);
	}
	.name {
		align-self: end;
		font-weight: 700;
	}
	.party {
		align-self: start;
		font-size: 14px;
		color: var(--muted);
	}
	@media (hover: hover) {
		.play:hover {
			background: var(--brand-hover);
		}
		nav a:hover {
			background: var(--brand-soft);
			border-color: var(--brand);
		}
	}
</style>
