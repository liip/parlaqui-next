<script lang="ts">
	import type { Phase } from '$lib/game/round-loop';

	type Props = {
		url: string;
		alt: string;
		phase: Phase;
		remainingMs: number;
		onload(): void;
		onerror(): void;
	};

	let { url, alt, phase, remainingMs, onload, onerror }: Props = $props();

	const CIRCUMFERENCE = 2 * Math.PI * 125;
</script>

<div class="photo">
	{#if url}
		{#key url}
			<img src={url} {alt} {onload} {onerror} />
		{/key}
	{:else}
		<div class="blank"></div>
	{/if}
	<svg viewBox="-130 -130 260 260" aria-hidden="true">
		<circle class="track" cx="0" cy="0" r="125" />
		<circle
			class="run"
			class:draining={remainingMs > 0}
			class:frozen={phase !== 'playing'}
			cx="0"
			cy="0"
			r="125"
			style="stroke-dasharray: {CIRCUMFERENCE}px; --circumference: {CIRCUMFERENCE}px; animation-duration: {remainingMs}ms"
		/>
	</svg>
</div>

<style>
	.photo {
		position: relative;
		display: inline-block;
		margin: 10px 10px 34px;
	}
	img,
	.blank {
		display: block;
		width: 200px;
		height: 200px;
		border-radius: 50%;
		object-fit: cover;
		background: var(--rule);
	}
	svg {
		position: absolute;
		top: -10px;
		left: -10px;
		width: 220px;
		height: 220px;
		fill: transparent;
		stroke-width: 10px;
		transform: rotateY(-180deg) rotateZ(-90deg);
	}
	.track {
		stroke: var(--rule);
	}
	.run {
		stroke: var(--ring);
	}
	.draining {
		animation-name: drain;
		animation-timing-function: linear;
		animation-fill-mode: forwards;
	}
	.frozen {
		animation-play-state: paused;
	}
	/* a jump each second instead of a continuous sweep, still showing the time left */
	@media (prefers-reduced-motion: reduce) {
		.draining {
			animation-timing-function: steps(10, end);
		}
	}
	@keyframes drain {
		from {
			stroke-dashoffset: 0;
		}
		to {
			stroke-dashoffset: var(--circumference);
		}
	}
	/* phones: centred and as large as the height left by the answers allows, the old site had 200px */
	@media (max-width: 899px) and (max-height: 1000px) {
		.photo {
			--size: 150px;
			margin: 8px 8px 10px;
		}
		@supports (height: 1svh) {
			.photo {
				/* narrower screens wrap the names on more lines */
				--size: clamp(80px, 100svh - 382px - max(0px, (400px - 100vw) * 0.75), 220px);
			}
		}
		img,
		.blank {
			width: var(--size);
			height: var(--size);
		}
		svg {
			top: -8px;
			left: -8px;
			width: calc(var(--size) + 16px);
			height: calc(var(--size) + 16px);
		}
	}
	@media (max-height: 500px) and (min-width: 560px) {
		.photo {
			margin: 6px;
		}
		img,
		.blank {
			width: 120px;
			height: 120px;
		}
		svg {
			top: -6px;
			left: -6px;
			width: 132px;
			height: 132px;
		}
	}
</style>
