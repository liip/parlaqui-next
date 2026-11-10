<script lang="ts">
	import DataSource from '$lib/components/DataSource.svelte';
	import CouncilChoice from '$lib/components/CouncilChoice.svelte';
	import { translate } from '$lib/i18n';
	import { OG_IMAGE, OG_LOCALES, alternates, jsonLd, pageUrl, structuredData } from '$lib/seo';

	let { data } = $props();

	const title = $derived(translate(data.language, 'seo.title'));
	const description = $derived(
		translate(data.language, 'seo.description', { members: data.members })
	);
	const url = $derived(pageUrl(data.language));

	const PHOTO_PAGE =
		'https://commons.wikimedia.org/wiki/File:Nordfassade_Bundeshaus_-_fr%C3%BCh_morgens.jpg';
	const PHOTO_LICENSE = 'https://creativecommons.org/licenses/by-sa/4.0/';
	// a short phone hides the photo, so it gets a 1 px image instead of downloading the banner
	const SHORT_PHONE = '(max-width: 899px) and (max-height: 719px)';
	const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={url} />
	{#each alternates() as alternate (alternate.hreflang)}
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
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- jsonLd escapes every "<" -->
	{@html jsonLd(structuredData(data.language, title, description))}
</svelte:head>

<section>
	<figure>
		<picture>
			<source media={SHORT_PHONE} srcset={BLANK} />
			<img
				src="/images/bundeshaus-686.jpg"
				srcset="/images/bundeshaus-686.jpg 686w, /images/bundeshaus-1024.jpg 1024w"
				sizes="(min-width: 544px) 512px, calc(100vw - 32px)"
				width="1024"
				height="512"
				alt=""
				fetchpriority="high"
			/>
		</picture>
		<figcaption>
			{translate(data.language, 'home.photoBy')}
			<a href={PHOTO_PAGE}>VOLLTOLL / Manuel Lopez</a>,
			{translate(data.language, 'home.photoCropped')},
			<a href={PHOTO_LICENSE}>CC BY-SA 4.0</a>
		</figcaption>
	</figure>
	<h1>{translate(data.language, 'home.title')}</h1>
	<p class="rules">{translate(data.language, 'home.rules', { members: data.members })}</p>
	<CouncilChoice language={data.language} members={data.members} />
	{#if data.stale}
		<p class="stale">{translate(data.language, 'home.stale')}</p>
	{/if}
	<div class="about">
		<h2>{translate(data.language, 'about.title')}</h2>
		<p>{translate(data.language, 'about.game')}</p>
		<p>{translate(data.language, 'about.data')}</p>
		<DataSource language={data.language} asOf={data.asOf} />
		<p>{translate(data.language, 'about.who')}</p>
		<p><a href="/{data.language}/members">{translate(data.language, 'members.link')}</a></p>
	</div>
</section>

<style>
	section {
		max-width: 32rem;
		margin: 0 auto;
		padding: 32px 16px;
		text-align: center;
	}
	figure {
		margin: 0 0 24px;
	}
	img {
		display: block;
		width: 100%;
		height: auto;
		aspect-ratio: 2;
		object-fit: cover;
		border-radius: 12px;
		background: var(--rule);
	}
	figcaption {
		margin-top: 4px;
		font-size: 11px;
		text-align: right;
		color: var(--muted);
	}
	figcaption a {
		color: inherit;
		text-decoration: underline;
	}
	figcaption a:focus-visible {
		outline: 2px solid var(--ink);
		outline-offset: 2px;
	}
	h1 {
		margin: 0 0 12px;
		font-size: 34px;
		font-weight: 900;
		line-height: 1.1;
		letter-spacing: -0.03em;
	}
	.rules {
		margin: 0 0 32px;
		font-size: 17px;
		line-height: 1.4;
		color: var(--muted);
	}
	@media (max-width: 543px) {
		section {
			padding-top: 16px;
		}
		figure {
			margin-bottom: 16px;
		}
		img {
			aspect-ratio: 2.6;
		}
	}
	/* on a short phone the photo would push Play out of sight */
	@media (max-width: 899px) and (max-height: 719px) {
		figure {
			display: none;
		}
	}
	.about {
		margin-top: 48px;
		padding-top: 24px;
		border-top: 1px solid var(--rule);
		text-align: left;
		color: var(--muted);
		font-size: 15px;
		line-height: 1.5;
	}
	.about h2 {
		margin: 0 0 8px;
		font-size: 16px;
		font-weight: 900;
		color: var(--ink);
	}
	.about p {
		margin: 0 0 8px;
	}
	.about a {
		color: var(--ink);
		font-weight: 700;
	}
	.stale {
		margin-top: 24px;
		color: var(--muted);
	}
</style>
