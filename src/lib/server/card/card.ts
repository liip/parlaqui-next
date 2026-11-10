import { parse, type Font, type Path } from 'opentype.js';
import sharp from 'sharp';
import { LOGO_CHARS, LOGO_OUTLINES } from '$lib/components/logo-paths';
import bold from './archivo-latin-700-normal.woff?inline';
import black from './archivo-latin-900-normal.woff?inline';
import palace from './bundeshaus.jpg?inline';

export type CardText = {
	label: string;
	tagline: string;
	score: number;
	outOf: string;
	council: string;
	correct: string;
	challenge: string;
	by: string;
	photoCredit: string;
};

const PETROL = '#033840';
const BRAND = '#5fd1ad';
const PAPER = '#fafafa';
const MUTED = '#a9bdbf';

const STORY = { width: 1080, height: 1920 };

const fontOf = (dataUrl: string): Font => {
	const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
	return parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
};

let fonts: { bold: Font; black: Font } | undefined;
export const loadFonts = () => (fonts ??= { bold: fontOf(bold), black: fontOf(black) });

type Line = {
	text: string;
	font: Font;
	size: number;
	x: number;
	y: number;
	fill: string;
	anchor?: 'start' | 'middle';
	maxWidth?: number;
};

const tenth = (value: number) => Math.round(value * 10) / 10;

// written here rather than with opentype.js's toPathData, which prints NaN for some float values
function pathData(path: Path): string {
	return path.commands
		.map((command) => {
			switch (command.type) {
				case 'M':
				case 'L':
					return `${command.type}${tenth(command.x)} ${tenth(command.y)}`;
				case 'Q':
					return `Q${tenth(command.x1)} ${tenth(command.y1)} ${tenth(command.x)} ${tenth(command.y)}`;
				case 'C':
					return `C${tenth(command.x1)} ${tenth(command.y1)} ${tenth(command.x2)} ${tenth(command.y2)} ${tenth(command.x)} ${tenth(command.y)}`;
				default:
					return 'Z';
			}
		})
		.join('');
}

// glyph by glyph with kerning: opentype.js cannot apply some of Archivo's contextual substitutions
function layout(font: Font, text: string, size: number) {
	const scale = size / font.unitsPerEm;
	const glyphs = [...text].map((char) => font.charToGlyph(char));
	const offsets: number[] = [];
	let advance = 0;
	glyphs.forEach((glyph, i) => {
		if (i > 0) advance += font.getKerningValue(glyphs[i - 1], glyph) * scale;
		offsets.push(advance);
		advance += (glyph.advanceWidth ?? 0) * scale;
	});
	return { glyphs, offsets, width: advance };
}

// the server image has no fonts installed, so every word is drawn as a path
export function line({ text, font, size, x, y, fill, anchor = 'start', maxWidth }: Line): string {
	const natural = layout(font, text, size).width;
	const fitted = tenth(maxWidth && natural > maxWidth ? (size * maxWidth) / natural : size);
	const { glyphs, offsets, width } = layout(font, text, fitted);
	const left = anchor === 'middle' ? x - width / 2 : x;
	const d = glyphs
		.map((glyph, i) => pathData(glyph.getPath(left + offsets[i], y, fitted)))
		.join('');
	return `<path fill="${fill}" d="${d}"/>`;
}

// the Federal Palace behind everything, faint enough that the text keeps its contrast
const watermark = (width: number, height: number) =>
	`<filter id="grey"><feColorMatrix type="saturate" values="0"/></filter>` +
	`<image href="${palace}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" opacity="0.16" filter="url(#grey)"/>`;

const logo = (x: number, y: number, scale: number) =>
	`<g transform="translate(${x} ${y}) scale(${scale}) translate(-20 -19)" fill="${PAPER}">` +
	LOGO_CHARS.map((d) => `<path d="${d}"/>`).join('') +
	LOGO_OUTLINES.map((d) => `<path d="${d}" fill="none" stroke="${PAPER}"/>`).join('') +
	'</g>';

// stories hide about 250 px at the top and 340 px at the bottom under their own controls
function storySvg(text: CardText, f: { bold: Font; black: Font }): string {
	const { width, height } = STORY;
	const middle = width / 2;
	const span = width - 160;
	const centered = { x: middle, anchor: 'middle' as const, maxWidth: span };
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
		`<rect width="${width}" height="${height}" fill="${PETROL}"/>`,
		watermark(width, height),
		logo(middle - 157, 290, 1.3),
		line({ ...centered, text: text.tagline, font: f.bold, size: 42, y: 560, fill: PAPER }),
		line({ ...centered, text: text.label, font: f.bold, size: 56, y: 680, fill: BRAND }),
		line({
			...centered,
			text: String(text.score),
			font: f.black,
			size: 460,
			y: 1110,
			fill: BRAND,
			maxWidth: undefined
		}),
		line({ ...centered, text: text.outOf, font: f.bold, size: 60, y: 1215, fill: PAPER }),
		line({ ...centered, text: text.council, font: f.bold, size: 46, y: 1310, fill: PAPER }),
		line({ ...centered, text: text.correct, font: f.bold, size: 46, y: 1375, fill: PAPER }),
		line({ ...centered, text: text.challenge, font: f.black, size: 80, y: 1490, fill: PAPER }),
		line({
			...centered,
			text: `parlaqui.ch · ${text.by}`,
			font: f.bold,
			size: 44,
			y: 1570,
			fill: BRAND
		}),
		line({ ...centered, text: text.photoCredit, font: f.bold, size: 24, y: 1640, fill: MUTED }),
		'</svg>'
	].join('');
}

export async function renderCard(text: CardText): Promise<Buffer> {
	return sharp(Buffer.from(storySvg(text, loadFonts())))
		.jpeg({ quality: 82, mozjpeg: true })
		.toBuffer();
}
