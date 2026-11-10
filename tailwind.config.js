/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	theme: {
		extend: {
			// preflight reads this: it is what puts Archivo on `html`, not a utility class
			fontFamily: {
				sans: ['Archivo', 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif']
			}
		}
	},
	plugins: []
};
