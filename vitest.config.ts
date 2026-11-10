import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		pool: 'forks'
	},
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
			// SvelteKit generates this module at build time; vitest runs without the plugin
			'$env/dynamic/private': fileURLToPath(
				new URL('./test/env-dynamic-private.ts', import.meta.url)
			)
		}
	}
});
