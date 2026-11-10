<script lang="ts">
	let { data } = $props();

	const report = $derived(data.report);
	const total = (pick: (day: (typeof report)['days'][number]) => number) =>
		report.days.reduce((sum, day) => sum + pick(day), 0);
	const days = $derived([...report.days].reverse());
</script>

<svelte:head>
	<title>Audience · Parlaqui</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main>
	<h1>Audience</h1>
	<p class="span">
		Du {report.from} au {report.to} ·
		<a href="?days=7">7 jours</a> · <a href="?days=30">30 jours</a> ·
		<a href="?days=90">90 jours</a> · <a href="?days=365">1 an</a>
	</p>
	<dl class="totals">
		<div>
			<dt>Visiteurs (jours cumulés)</dt>
			<dd>{total((day) => day.visitors)}</dd>
		</div>
		<div>
			<dt>Accueil</dt>
			<dd>{total((day) => day.views.home)}</dd>
		</div>
		<div>
			<dt>Liste des membres</dt>
			<dd>{total((day) => day.views.members)}</dd>
		</div>
		<div>
			<dt>Parties commencées</dt>
			<dd>{total((day) => day.gamesStarted)}</dd>
		</div>
		<div>
			<dt>Parties terminées</dt>
			<dd>{total((day) => day.gamesFinished)}</dd>
		</div>
	</dl>

	<h2>Par jour</h2>
	<div class="scroll">
		<table>
			<thead>
				<tr>
					<th>Jour</th><th>Visiteurs</th><th>Accueil</th><th>Membres</th>
					<th>Parties</th><th>Terminées</th>
				</tr>
			</thead>
			<tbody>
				{#each days as day (day.day)}
					<tr>
						<td>{day.day}</td><td>{day.visitors}</td><td>{day.views.home}</td>
						<td>{day.views.members}</td>
						<td>{day.gamesStarted}</td><td>{day.gamesFinished}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<h2>D'où viennent les visiteurs</h2>
	{#if report.referrers.length === 0}
		<p>Aucun site d'origine sur cette période.</p>
	{:else}
		<table>
			<tbody>
				{#each report.referrers as referrer (referrer.host)}
					<tr><td>{referrer.label}</td><td>{referrer.views}</td></tr>
				{/each}
			</tbody>
		</table>
	{/if}

	<h2>Langues et appareils</h2>
	<p>
		{#each Object.entries(report.languages) as [language, views] (language)}
			<span class="pill">{language} {views}</span>
		{/each}
		{#each Object.entries(report.devices) as [device, views] (device)}
			<span class="pill">{device === 'mobile' ? 'téléphone' : 'ordinateur'} {views}</span>
		{/each}
	</p>
</main>

<style>
	main {
		max-width: 52rem;
		margin: 0 auto;
		padding: 32px 16px;
	}
	h1 {
		margin: 0 0 16px;
		font-size: 30px;
		font-weight: 900;
	}
	h2 {
		margin: 32px 0 8px;
		font-size: 18px;
		font-weight: 900;
	}
	.span {
		color: var(--muted);
	}
	.span a {
		color: var(--ink);
	}
	.totals {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
		gap: 8px;
		margin: 16px 0 0;
	}
	.totals div {
		padding: 12px;
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: 12px;
	}
	dt {
		font-size: 13px;
		color: var(--muted);
	}
	dd {
		margin: 4px 0 0;
		font-size: 26px;
		font-weight: 900;
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		padding: 6px 8px;
		text-align: right;
		border-bottom: 1px solid var(--rule);
		white-space: nowrap;
	}
	th:first-child,
	td:first-child {
		text-align: left;
	}
	.pill {
		display: inline-block;
		margin: 0 6px 6px 0;
		padding: 4px 10px;
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: 999px;
	}
	a:focus-visible {
		outline: 3px solid var(--ink);
		outline-offset: 2px;
	}
</style>
