import { describe, expect, it } from 'vitest';
import { privacy } from './index';

describe('privacy page', () => {
	it('says the same things in every language', () => {
		const shape = (language: keyof typeof privacy) =>
			privacy[language].sections.map((section) => section.paragraphs.length);
		for (const language of ['fr', 'it', 'rm'] as const) {
			expect(shape(language)).toEqual(shape('de'));
		}
	});

	it('names the controller, the contact and both cookies in every language', () => {
		for (const text of Object.values(privacy)) {
			const all = JSON.stringify(text);
			for (const needed of [
				'Liip AG',
				'contact@liip.ch',
				'pq.visitor',
				'pq.lang',
				'24',
				'90',
				'400'
			]) {
				expect(all).toContain(needed);
			}
		}
	});

	it('calls the stored cookie a hash, never an encryption', () => {
		for (const text of Object.values(privacy)) {
			expect(JSON.stringify(text)).toMatch(/hash|hachage/i);
			expect(JSON.stringify(text)).not.toMatch(/chiffr|verschlüssel|cifrat|criptad/i);
		}
	});
});
