import { lastPublishedAt } from '../db/members';
import type { Db } from '../db/sqlite';
import { uploadToRokka } from '../photo/rokka';
import { fetchPortrait } from '../photo/source';
import { zurichDay } from '../zurich';
import { importRoster, type Deps, type ImportOutcome } from './import';
import { fetchSnapshot } from './parl-client';
import { syncPhotos } from './photo-sync';
import { checkPhoto } from './photos';

// without a rokka key the portraits on rokka are left as they are
export const importDeps = (db: Db, apiKey: string, rokkaKey: string | undefined): Deps => ({
	fetchSnapshot: () => fetchSnapshot(apiKey),
	checkPhoto,
	syncPhotos: rokkaKey
		? () =>
				syncPhotos(db, {
					download: (code) => fetchPortrait(code),
					upload: (image) => uploadToRokka(image, rokkaKey)
				})
		: undefined
});

// a published roster whose portraits all refreshed, or an import another process is running
export function importSucceeded(outcome: ImportOutcome): boolean {
	const photosFailed = Boolean(outcome.photosError) || (outcome.photos?.failed ?? 0) > 0;
	return (outcome.status === 'published' || outcome.status === 'skipped') && !photosFailed;
}

// once per Zurich day, restarts included: a roster already published that day is not fetched again.
// Throws when the import did not succeed, so the daily task tries again later
export async function importIfStale(db: Db, deps: Deps, now: Date): Promise<ImportOutcome | null> {
	const published = await lastPublishedAt(db);
	if (published && zurichDay(published) === zurichDay(now)) return null;
	const outcome = await importRoster(db, deps);
	if (!importSucceeded(outcome)) {
		throw new Error(
			`roster import ${outcome.status}: ${outcome.photosError ?? outcome.detail ?? ''}`
		);
	}
	return outcome;
}
