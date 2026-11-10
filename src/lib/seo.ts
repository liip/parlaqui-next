import { LANGUAGES, type Language } from '$lib/i18n';

// canonical links always name production, so a staging copy never competes with it
const SITE_ORIGIN = 'https://parlaqui.ch';
const INDEXED_HOSTS = ['parlaqui.ch'];

export const OG_IMAGE = { url: `${SITE_ORIGIN}/images/og.jpg`, width: 1200, height: 630 };

export const OG_LOCALES: Record<Language, string> = {
	de: 'de_CH',
	fr: 'fr_CH',
	it: 'it_CH',
	rm: 'rm_CH'
};

// the pages worth finding, as paths after the language
const INDEXED_PAGES = ['', '/members', '/privacy'];

export const pageUrl = (language: Language, path = ''): string =>
	`${SITE_ORIGIN}/${language}${path}`;

// German, not the root: the root only redirects, and an alternate must answer itself
export const alternates = (path = ''): { hreflang: string; href: string }[] => [
	...LANGUAGES.map((language) => ({ hreflang: language, href: pageUrl(language, path) })),
	{ hreflang: 'x-default', href: pageUrl('de', path) }
];

export const isIndexedHost = (host: string): boolean =>
	INDEXED_HOSTS.includes(host.toLowerCase().replace(/:\d+$/, ''));

export const robotsTxt = (indexed: boolean): string =>
	indexed
		? `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /photo/\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`
		: 'User-agent: *\nDisallow: /\n';

export const sitemapXml = (): string => {
	const urls = INDEXED_PAGES.flatMap((path) => {
		const links = alternates(path)
			.map(
				({ hreflang, href }) =>
					`<xhtml:link rel="alternate" hreflang="${hreflang}" href="${href}"/>`
			)
			.join('');
		return LANGUAGES.map((language) => `<url><loc>${pageUrl(language, path)}</loc>${links}</url>`);
	});
	return (
		'<?xml version="1.0" encoding="UTF-8"?>\n' +
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">' +
		urls.join('') +
		'</urlset>\n'
	);
};

export const structuredData = (language: Language, headline: string, description: string) => ({
	'@context': 'https://schema.org',
	'@type': 'WebApplication',
	name: 'Parlaqui',
	alternateName: headline,
	url: pageUrl(language),
	description,
	inLanguage: language,
	applicationCategory: 'GameApplication',
	operatingSystem: 'Any',
	isAccessibleForFree: true,
	offers: { '@type': 'Offer', price: '0', priceCurrency: 'CHF' },
	image: OG_IMAGE.url,
	creator: { '@type': 'Organization', name: 'Liip', url: 'https://www.liip.ch' },
	about: { '@type': 'GovernmentOrganization', name: 'Federal Assembly of Switzerland' }
});

// a JSON-LD block is raw script content, so nothing in it may close the tag
export const jsonLd = (data: unknown): string =>
	`<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
