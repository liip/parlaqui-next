import { describe, expect, it } from 'vitest';
import { de } from './de';
import { fr } from './fr';
import { it as italian } from './it';
import { rm } from './rm';
import {
	LANGUAGES,
	createTranslate,
	isOne,
	legacyHashLanguage,
	pickLanguage,
	switchPath,
	translate
} from '$lib/i18n';

describe('pickLanguage', () => {
	it('lets the cookie win over the browser', () => {
		expect(pickLanguage('fr', 'de-CH,de;q=0.9')).toBe('fr');
	});

	it('follows the browser language when there is no cookie', () => {
		expect(pickLanguage(undefined, 'it-CH,it;q=0.9,de;q=0.8')).toBe('it');
	});

	it('falls back to German', () => {
		expect(pickLanguage(undefined, 'en-US,en;q=0.9')).toBe('de');
		expect(pickLanguage('xx', null)).toBe('de');
	});
});

describe('legacyHashLanguage', () => {
	it('reads the language of an old #fr link', () => {
		expect(legacyHashLanguage('#fr')).toBe('fr');
		expect(legacyHashLanguage('#rm')).toBe('rm');
	});

	it('ignores anything else', () => {
		expect(legacyHashLanguage('#en')).toBeNull();
		expect(legacyHashLanguage('')).toBeNull();
	});
});

describe('switchPath', () => {
	it('replaces the language segment and keeps the rest', () => {
		expect(switchPath({ pathname: '/de', search: '' }, 'fr')).toBe('/fr');
		expect(switchPath({ pathname: '/de/rangliste', search: '' }, 'it')).toBe('/it/rangliste');
	});

	it('keeps the query string', () => {
		expect(switchPath(new URL('https://x.ch/de/game?council=N'), 'fr')).toBe('/fr/game?council=N');
	});
});

describe('translate', () => {
	it('falls back to German when the language lacks the key', () => {
		const partial = createTranslate({
			de: { title: 'Titel', 'language.de': 'Deutsch' },
			fr: { title: 'Titre' },
			it: {},
			rm: {}
		} as never);
		expect(partial('fr', 'language.de')).toBe('Deutsch');
		expect(partial('rm', 'title')).toBe('Titel');
		expect(partial('fr', 'title')).toBe('Titre');
	});

	it('serves every language from the shipped dictionaries', () => {
		expect(translate('fr', 'title')).toBe('Parlaqui');
		expect(translate('rm', 'language.rm')).toBe('Rumantsch');
		expect(translate('rm', 'home.play')).toBe('Giugar');
	});

	it('interpolates parameters', () => {
		expect(translate('de', 'end.correctOf', { correct: 7, total: 10 })).toBe('7 von 10');
		expect(translate('it', 'game.verdictRight', { points: 8 })).toBe('Risposta giusta · +8');
		expect(translate('fr', 'end.outOf', { max: 100 })).toBe('/ 100 points');
	});

	it('never starts a wrong verdict like a right one', () => {
		for (const language of LANGUAGES) {
			const right = translate(language, 'game.verdictRight', { points: 8 }).split(' ')[0];
			const wrong = translate(language, 'game.verdictWrong', { name: '' });
			expect(wrong.toLowerCase()).not.toContain(right.toLowerCase());
		}
		expect(translate('fr', 'game.verdictWrong', { name: 'Maya Graf' })).toBe(
			"Pas cette fois · C'était Maya Graf"
		);
	});

	it('keeps the meta descriptions within the 160 characters a search result shows', () => {
		for (const language of LANGUAGES) {
			for (const key of ['seo.description', 'members.description'] as const) {
				const text = translate(language, key, { members: 246 });
				expect(text.length, `${language} ${key}`).toBeLessThanOrEqual(160);
			}
		}
	});

	it('has every German key in French, Italian and Romansh', () => {
		for (const dictionary of [fr, italian, rm]) {
			expect(Object.keys(dictionary).sort()).toEqual(Object.keys(de).sort());
		}
	});
});

describe('isOne', () => {
	it('follows each language: French counts 0 as one, German and Italian do not', () => {
		expect([isOne('fr', 0), isOne('fr', 1), isOne('fr', 2)]).toEqual([true, true, false]);
		expect([isOne('de', 0), isOne('de', 1), isOne('de', 2)]).toEqual([false, true, false]);
		expect([isOne('it', 0), isOne('it', 1), isOne('it', 2)]).toEqual([false, true, false]);
		expect(isOne('rm', 1)).toBe(true);
	});
});
