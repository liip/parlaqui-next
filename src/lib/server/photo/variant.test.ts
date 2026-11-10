import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { renderVariant } from './variant';

async function sourceImage(exif = false): Promise<Buffer> {
	const gradient = Buffer.alloc(300 * 400 * 3);
	for (let i = 0; i < gradient.length; i++) gradient[i] = (i * 7) % 256;
	const image = sharp(gradient, { raw: { width: 300, height: 400, channels: 3 } });
	return (exif ? image.withExif({ IFD0: { Copyright: 'someone' } }) : image).jpeg().toBuffer();
}

describe('renderVariant', () => {
	it('renders a 240 x 240 JPEG', async () => {
		const out = await renderVariant(await sourceImage(), {
			size: 0.95,
			x: 0.5,
			y: 0.5,
			quality: 80
		});
		const meta = await sharp(out).metadata();
		expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 240, 240]);
	});

	it('two crops of the same source give different bytes', async () => {
		const source = await sourceImage();
		const a = await renderVariant(source, { size: 0.9, x: 0, y: 0, quality: 76 });
		const b = await renderVariant(source, { size: 0.97, x: 1, y: 1, quality: 88 });
		expect(a.equals(b)).toBe(false);
	});

	it('strips metadata', async () => {
		const source = await sourceImage(true);
		expect((await sharp(source).metadata()).exif).toBeDefined();
		const out = await renderVariant(source, { size: 0.95, x: 0.5, y: 0.5, quality: 80 });
		expect((await sharp(out).metadata()).exif).toBeUndefined();
	});
});
