<script lang="ts">
	import { LOGO_CHARS as chars, LOGO_OUTLINES as outlines } from './logo-paths';
</script>

<div class="logo">
	<svg viewBox="20 19 241.70284 113.95426" role="img" aria-label="Parlaqui">
		{#each chars as char, i (i)}
			<path d={char} />
		{/each}
		{#each outlines as outline, i (i)}
			<path class="trace" d={outline} />
		{/each}
	</svg>
</div>

<style>
	.logo {
		display: inline-block;
		fill: var(--ink);
	}
	.trace {
		stroke: var(--ink);
		fill: transparent;
	}
	svg {
		width: 237px;
		height: 97px;
	}
	@media (max-width: 360px) {
		svg {
			width: 115px;
			height: 45px;
		}
	}
</style>
