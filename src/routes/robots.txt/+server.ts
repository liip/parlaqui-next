import { isIndexedHost, robotsTxt } from '$lib/seo';

export const GET = ({ url }) =>
	new Response(robotsTxt(isIndexedHost(url.host)), {
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'cache-control': 'public, max-age=3600'
		}
	});
