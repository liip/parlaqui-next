import { error } from '@sveltejs/kit';
import { LANGUAGE_COOKIE, isLanguage } from '$lib/i18n';

const ONE_YEAR = 60 * 60 * 24 * 365;

export const load = ({ cookies, params }) => {
	const language = params.lang;
	if (!isLanguage(language)) throw error(404);

	cookies.set(LANGUAGE_COOKIE, language, {
		path: '/',
		maxAge: ONE_YEAR,
		sameSite: 'lax',
		httpOnly: true
	});
	return { language };
};
