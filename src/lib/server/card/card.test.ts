import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { line, loadFonts, renderCard, type CardText } from './card';

const text: CardText = {
	label: 'Mon score Parlaqui',
	tagline: 'Le quiz photo du Parlement suisse',
	score: 73,
	outOf: '/ 100 points',
	council: 'Conseil des États',
	correct: '8 bonnes réponses sur 10',
	challenge: 'Tu fais mieux ?',
	by: 'Par Liip',
	photoCredit: 'Photo\u00a0: VOLLTOLL / Manuel Lopez, CC BY-SA 4.0'
};

describe('renderCard', () => {
	it('draws the story card at its size', async () => {
		const meta = await sharp(await renderCard(text)).metadata();
		expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 1080, 1920]);
	});

	it('draws the text itself, so the card does not depend on fonts installed on the server', async () => {
		const plain = await renderCard({ ...text, correct: '' });
		const withDetail = await renderCard(text);
		expect(withDetail.equals(plain)).toBe(false);
	});

	it('shrinks a long line instead of letting it run off the card', async () => {
		const long = {
			...text,
			council: 'Consiglio degli Stati · 10 risposte giuste su 10 '.repeat(3)
		};
		const { info } = await sharp(await renderCard(long))
			.extract({ left: 0, top: 1290, width: 40, height: 80 })
			.raw()
			.toBuffer({ resolveWithObject: true });
		expect(info.width).toBe(40);
	});

	it('never writes NaN into a path, whatever position the text lands on', () => {
		const { bold } = loadFonts();
		for (let x = 300; x < 400; x += 0.37) {
			const path = line({
				text: 'Mon score Parlaqui',
				font: bold,
				size: 60,
				x,
				y: 640,
				fill: '#000'
			});
			expect(path).not.toContain('NaN');
		}
	});

	it('never writes NaN for any score at any size', () => {
		const { black } = loadFonts();
		for (let size = 40; size <= 520; size += 20) {
			for (const score of ['0', '18', '73', '100']) {
				expect(line({ text: score, font: black, size, x: 56, y: 500, fill: '#000' })).not.toContain(
					'NaN'
				);
			}
		}
	});

	it('draws a non-breaking space like a space, so the French credit keeps its gap', () => {
		for (const font of Object.values(loadFonts())) {
			// a missing glyph would be drawn as the .notdef box, and the paths would differ
			expect(font.charToGlyph('\u00a0').advanceWidth).toBe(font.charToGlyph(' ').advanceWidth);
			const at = { font, size: 24, x: 56, y: 600, fill: '#000' };
			expect(line({ ...at, text: 'Photo\u00a0: VOLLTOLL' })).toBe(
				line({ ...at, text: 'Photo : VOLLTOLL' })
			);
		}
	});
});
