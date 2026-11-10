import sharp from 'sharp';

export type Crop = { size: number; x: number; y: number; quality: number };

const MIN_SIZE = 0.9;
const MAX_SIZE = 0.97;
const MIN_QUALITY = 76;
const MAX_QUALITY = 88;

export function randomCrop(random: () => number = Math.random): Crop {
	return {
		size: MIN_SIZE + random() * (MAX_SIZE - MIN_SIZE),
		x: random(),
		y: random(),
		quality: MIN_QUALITY + Math.floor(random() * (MAX_QUALITY - MIN_QUALITY + 1))
	};
}

const OUTPUT_SIZE = 240;

export async function renderVariant(source: Buffer, crop: Crop): Promise<Buffer> {
	const { width = 0, height = 0 } = await sharp(source).metadata();
	const side = Math.floor(Math.min(width, height) * crop.size);
	return sharp(source)
		.extract({
			left: Math.round((width - side) * crop.x),
			top: Math.round((height - side) * crop.y),
			width: side,
			height: side
		})
		.resize(OUTPUT_SIZE, OUTPUT_SIZE)
		.jpeg({ quality: crop.quality })
		.toBuffer();
}
