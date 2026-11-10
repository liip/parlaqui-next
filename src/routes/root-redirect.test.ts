import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

const arrive = (cookie: string | undefined, acceptLanguage: string | null) => {
	const headers: Record<string, string> = {};
	const event = {
		cookies: { get: () => cookie },
		request: new Request('https://parlaqui.ch/', {
			headers: acceptLanguage ? { 'accept-language': acceptLanguage } : {}
		}),
		setHeaders: (set: Record<string, string>) => Object.assign(headers, set)
	};
	let thrown: unknown;
	try {
		load(event as unknown as Parameters<typeof load>[0]);
	} catch (cause) {
		thrown = cause;
	}
	return { thrown, headers };
};

describe('root redirect', () => {
	it('sends the browser language and tells caches it depends on it and on the cookie', () => {
		const { thrown, headers } = arrive(undefined, 'it-CH,it;q=0.9');
		expect(thrown).toMatchObject({ status: 302, location: '/it' });
		expect(headers.vary).toBe('Accept-Language, Cookie');
	});

	it('lets the language cookie win', () => {
		expect(arrive('rm', 'fr').thrown).toMatchObject({ location: '/rm' });
	});
});
