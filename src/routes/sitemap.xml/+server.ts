import { sitemapXml } from '$lib/seo';

export const GET = () =>
	new Response(sitemapXml(), {
		headers: {
			'content-type': 'application/xml; charset=utf-8',
			'cache-control': 'public, max-age=3600'
		}
	});
