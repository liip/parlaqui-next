import { redirect } from '@sveltejs/kit';
import { LANGUAGE_COOKIE, pickLanguage } from '$lib/i18n';

// on the server, so old links and crawlers land on a real page; the browser keeps an old #fr across it
export const load = ({ cookies, request, setHeaders }) => {
	const language = pickLanguage(
		cookies.get(LANGUAGE_COOKIE),
		request.headers.get('accept-language')
	);
	// a cache must not hand one visitor's language to the next
	setHeaders({ vary: 'Accept-Language, Cookie' });
	throw redirect(302, `/${language}`);
};
