declare module 'opentype.js' {
	export type PathCommand =
		| { type: 'M' | 'L'; x: number; y: number }
		| { type: 'Q'; x1: number; y1: number; x: number; y: number }
		| { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
		| { type: 'Z' };
	export interface Path {
		commands: PathCommand[];
	}
	export interface Glyph {
		advanceWidth?: number;
		getPath(x: number, y: number, fontSize: number): Path;
	}
	export interface Font {
		unitsPerEm: number;
		charToGlyph(char: string): Glyph;
		getKerningValue(left: Glyph, right: Glyph): number;
	}
	export function parse(buffer: ArrayBuffer): Font;
}
