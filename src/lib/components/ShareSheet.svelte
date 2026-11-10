<script lang="ts">
	import { translate, type Language } from '$lib/i18n';

	export type Shareable = { story: string; file: File | null };

	type Props = { language: Language; ready: Promise<Shareable | null>; onretry(): void };

	let { language, ready, onretry }: Props = $props();

	let dialog: HTMLDialogElement;
	let shareable = $state<Shareable | null>(null);
	let failed = $state(false);
	let preview = $state<string | null>(null);

	// a phone saves to its photos only through the share sheet, which offers "Save image" next to
	// the apps; a computer gets a plain download instead of its share menu
	const sharesFiles = $derived(
		Boolean(
			shareable?.file &&
			matchMedia('(pointer: coarse)').matches &&
			navigator.canShare?.({ files: [shareable.file] })
		)
	);

	let sharing = false;

	$effect(() => {
		let alive = true;
		let objectUrl: string | null = null;
		shareable = null;
		failed = false;
		// the cleanup below revokes the previous image's URL, so it must not stay the preview
		preview = null;
		void ready.then((result) => {
			if (!alive) return;
			shareable = result;
			failed = !result;
			if (result?.file) preview = objectUrl = URL.createObjectURL(result.file);
		});
		return () => {
			alive = false;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	});

	export function open() {
		dialog.showModal();
	}

	const save = async () => {
		if (!shareable?.file || sharing) return;
		sharing = true;
		try {
			await navigator.share({ files: [shareable.file] });
		} catch {
			// the person closed the share sheet; nothing to tell them
		} finally {
			sharing = false;
		}
	};

	const closeOnBackdrop = (event: MouseEvent) => {
		if (event.target === dialog) dialog.close();
	};
</script>

<dialog bind:this={dialog} aria-labelledby="share-title" onclick={closeOnBackdrop}>
	<h2 id="share-title">{translate(language, 'share.sheetTitle')}</h2>
	{#if failed}
		<p role="alert">{translate(language, 'share.error')}</p>
		<button type="button" class="primary" onclick={onretry}>
			{translate(language, 'share.retry')}
		</button>
	{:else if !shareable}
		<p class="waiting" role="status">{translate(language, 'share.preparing')}</p>
	{:else}
		<img src={preview ?? shareable.story} alt={translate(language, 'share.imageAlt')} />
		{#if sharesFiles}
			<button type="button" class="primary" onclick={save}>
				{translate(language, 'share.save')}
			</button>
		{:else}
			<a class="primary" href={preview ?? shareable.story} download="parlaqui.jpg">
				{translate(language, 'share.save')}
			</a>
		{/if}
	{/if}
	<button type="button" class="close" onclick={() => dialog.close()}>
		{translate(language, 'share.close')}
	</button>
</dialog>

<style>
	dialog {
		width: 100%;
		max-width: 32rem;
		max-height: 100dvh;
		margin: auto auto 0;
		padding: 20px 16px calc(16px + env(safe-area-inset-bottom));
		border: 0;
		border-radius: 20px 20px 0 0;
		background: var(--surface);
		color: var(--ink);
		text-align: center;
		animation: rise 0.25s var(--ease);
	}
	dialog::backdrop {
		background: rgb(30 30 30 / 0.5);
	}
	@keyframes rise {
		from {
			transform: translateY(100%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		dialog {
			animation: none;
		}
	}
	h2 {
		margin: 0 0 12px;
		font-size: 18px;
		font-weight: 900;
	}
	img {
		display: block;
		height: min(52dvh, 420px);
		aspect-ratio: 9 / 16;
		margin: 0 auto 16px;
		border-radius: 12px;
		background: var(--ring);
	}
	button,
	.primary {
		display: block;
		width: 100%;
		margin-top: 8px;
		padding: 14px;
		font: inherit;
		font-size: 17px;
		font-weight: 900;
		color: var(--ink);
		text-decoration: none;
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: 14px;
		cursor: pointer;
	}
	.primary {
		background: var(--brand);
		border-color: var(--brand);
	}
	.close {
		border-color: transparent;
		font-weight: 500;
	}
	button:focus-visible,
	.primary:focus-visible {
		outline: 3px solid var(--ink);
		outline-offset: 2px;
	}
	@media (max-height: 640px) {
		h2 {
			margin-bottom: 8px;
		}
		img {
			height: 44dvh;
			margin-bottom: 8px;
		}
	}
	.waiting {
		margin: 24px 0;
		color: var(--muted);
	}
	@media (hover: hover) {
		.primary:hover {
			background: var(--brand-hover);
			border-color: var(--brand-hover);
		}
		.close:hover {
			background: transparent;
			border-color: transparent;
			text-decoration: underline;
		}
	}
</style>
