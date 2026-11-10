import { error, fail, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { INSIGHTS_COOKIE, SESSION_SECONDS, sessionOf } from '$lib/server/insights-session';
import { tokenMatches, tokenUsable } from '$lib/server/token';

export const load = () => {
	if (!tokenUsable(env.INSIGHTS_TOKEN)) throw error(404);
};

export const actions = {
	default: async ({ cookies, request, url }) => {
		const token = env.INSIGHTS_TOKEN;
		if (!tokenUsable(token)) throw error(404);
		const offered = String((await request.formData()).get('token') ?? '');
		if (!tokenMatches(offered, token)) return fail(403, { wrong: true });
		cookies.set(INSIGHTS_COOKIE, sessionOf(token, new Date()), {
			path: '/insights',
			httpOnly: true,
			sameSite: 'strict',
			secure: url.protocol === 'https:',
			maxAge: SESSION_SECONDS
		});
		throw redirect(303, '/insights');
	}
};
