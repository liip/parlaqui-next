import { de } from './de';
import { fr } from './fr';
import { it } from './it';
import { rm } from './rm';

export const LANGUAGES = ['de', 'fr', 'it', 'rm'] as const;
export type Language = (typeof LANGUAGES)[number];
export type MessageKey = keyof typeof de;
export type Messages = Partial<Record<MessageKey, string>>;

export const LANGUAGE_COOKIE = 'pq.lang';
const FALLBACK: Language = 'de';

export const isLanguage = (value: unknown): value is Language =>
	LANGUAGES.includes(value as Language);

const browserLanguages = (acceptLanguage: string) =>
	acceptLanguage
		.split(',')
		.map((part) => {
			const [tag, ...params] = part.trim().split(';');
			const q = params.find((p) => p.trim().startsWith('q='));
			return { code: tag.trim().slice(0, 2).toLowerCase(), q: q ? Number(q.trim().slice(2)) : 1 };
		})
		.filter(({ q }) => q > 0)
		.sort((a, b) => b.q - a.q)
		.map(({ code }) => code);

export const pickLanguage = (
	cookie: string | undefined,
	acceptLanguage: string | null
): Language => {
	if (isLanguage(cookie)) return cookie;
	return browserLanguages(acceptLanguage ?? '').find(isLanguage) ?? FALLBACK;
};

export const legacyHashLanguage = (hash: string): Language | null => {
	const code = hash.replace(/^#/, '');
	return isLanguage(code) ? code : null;
};

export const switchPath = (
	{ pathname, search }: { pathname: string; search: string },
	to: Language
): string => `${pathname.replace(/^\/[^/]*/, `/${to}`)}${search}`;

export const createTranslate =
	(dictionaries: Record<Language, Messages>) =>
	(lang: Language, key: MessageKey, params: Record<string, string | number> = {}): string => {
		const text = dictionaries[lang][key] ?? dictionaries[FALLBACK][key] ?? key;
		return text.replace(/\{(\w+)\}/g, (placeholder, name) =>
			name in params ? String(params[name]) : placeholder
		);
	};

export const translate = createTranslate({ de, fr, it, rm });

// French treats 0 as singular, German and Italian do not, so the language decides
export const isOne = (lang: Language, count: number): boolean => {
	try {
		return new Intl.PluralRules(lang).select(count) === 'one';
	} catch {
		return count === 1;
	}
};
