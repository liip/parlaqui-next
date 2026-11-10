<script lang="ts">
	import { translate, type Language } from '$lib/i18n';

	let { language, asOf }: { language: Language; asOf: string | null } = $props();

	// the Parliament's terms of use: its data names this source and the day it was fetched
	const text = $derived(
		[translate(language, 'data.source'), asOf && translate(language, 'data.asOf', { date: asOf })]
			.filter(Boolean)
			.join('. ') + '.'
	);
</script>

<p class="source">{text}</p>

<style>
	.source {
		font-size: 14px;
		color: var(--muted);
	}
</style>
