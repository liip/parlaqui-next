import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const forbidden = [
	'fonts.googleapis.com',
	'fonts.gstatic.com',
	'cdn.jsdelivr.net',
	'unpkg.com',
	'cdnjs.cloudflare.com'
];

const root = fileURLToPath(new URL('../..', import.meta.url));

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
}

function isText(buffer: Buffer): boolean {
	return !buffer.subarray(0, 8000).includes(0);
}

describe('third-party requests', () => {
	it('the browser never loads anything from a third party', () => {
		const offenders: string[] = [];
		for (const file of [...walk(join(root, 'src')), ...walk(join(root, 'static'))]) {
			if (file.endsWith('.test.ts')) continue;
			const buffer = readFileSync(file);
			if (!isText(buffer)) continue;
			const text = buffer.toString('utf8');
			for (const host of forbidden) {
				if (text.includes(host)) offenders.push(`${relative(root, file)}: ${host}`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
