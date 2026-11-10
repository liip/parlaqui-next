import { describe, expect, it } from 'vitest';
import { alternates, isIndexedHost, jsonLd, robotsTxt, sitemapXml } from './seo';

describe('seo', () => {
	it('links the four languages and German as default, never the redirecting root, always on parlaqui.ch', () => {
		expect(alternates()).toEqual([
			{ hreflang: 'de', href: 'https://parlaqui.ch/de' },
			{ hreflang: 'fr', href: 'https://parlaqui.ch/fr' },
			{ hreflang: 'it', href: 'https://parlaqui.ch/it' },
			{ hreflang: 'rm', href: 'https://parlaqui.ch/rm' },
			{ hreflang: 'x-default', href: 'https://parlaqui.ch/de' }
		]);
	});

	it('defaults the other pages to German too', () => {
		expect(alternates('/members').at(-1)).toEqual({
			hreflang: 'x-default',
			href: 'https://parlaqui.ch/de/members'
		});
	});

	it('indexes parlaqui.ch only, never staging or a local copy', () => {
		expect(isIndexedHost('parlaqui.ch')).toBe(true);
		expect(isIndexedHost('PARLAQUI.CH:443')).toBe(true);
		expect(isIndexedHost('staging.example')).toBe(false);
		expect(isIndexedHost('localhost:4311')).toBe(false);
	});

	it('lets crawlers in on production but keeps them off the API and the photos', () => {
		const production = robotsTxt(true);
		expect(production).toContain('Allow: /\n');
		expect(production).toContain('Disallow: /api/');
		expect(production).toContain('Disallow: /photo/');
		// never named: a robots.txt line would tell everyone where the audience page is
		expect(production).not.toContain('insights');
		expect(production).toContain('Sitemap: https://parlaqui.ch/sitemap.xml');
		expect(robotsTxt(false)).toBe('User-agent: *\nDisallow: /\n');
	});

	it('lists each indexed page in each language with its alternates', () => {
		const xml = sitemapXml();
		expect(xml.match(/<loc>/g)).toHaveLength(12);
		expect(xml).toContain('<loc>https://parlaqui.ch/rm</loc>');
		expect(xml).toContain('<loc>https://parlaqui.ch/it/members</loc>');
		expect(xml).toContain('hreflang="x-default" href="https://parlaqui.ch/de/members"');
		expect(xml).toContain('hreflang="x-default" href="https://parlaqui.ch/de"/>');
		expect(xml).not.toContain('href="https://parlaqui.ch/"');
	});

	it('escapes a closing tag inside JSON-LD', () => {
		expect(jsonLd({ name: '</script><b>' })).toBe(
			'<script type="application/ld+json">{"name":"\\u003c/script>\\u003cb>"}</script>'
		);
	});
});
