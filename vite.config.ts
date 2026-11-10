import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	// bundled, so the server uses its ESM build: the CommonJS one has no named exports for Node
	ssr: { noExternal: ['opentype.js'] }
});
