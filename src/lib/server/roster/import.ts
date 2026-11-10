import { list, sql, type Db } from '../db/sqlite';
import { parseSnapshot } from './parse';
import type { PhotoSyncOutcome } from './photo-sync';
import type { ParsedMember, RawSnapshot } from './types';
import { validateSnapshot } from './validate';

// a running import renews its lease every LEASE_RENEW_MS; one not renewed for this long died with its process
export const IMPORT_LEASE_MS = 2 * 60 * 1000;
export const LEASE_RENEW_MS = 30 * 1000;
const PHOTO_CHECK_CONCURRENCY = 8;
const MIN_PHOTO_LOSS_LIMIT = 10;
const PHOTO_LOSS_LIMIT_SHARE = 0.05;

export type ImportOutcome = {
	status: 'published' | 'rejected' | 'failed' | 'skipped';
	national?: number;
	states?: number;
	withoutPhoto?: number;
	detail?: string;
	photos?: PhotoSyncOutcome;
	photosError?: string;
};

export type Deps = {
	fetchSnapshot: () => Promise<RawSnapshot>;
	checkPhoto: (code: string) => Promise<boolean>;
	// runs after a publish, still under the import lease
	syncPhotos?: () => Promise<PhotoSyncOutcome>;
};

type RokkaCopies = Map<number, string>;

type CheckedMember = { member: ParsedMember; keepStoredPhoto: boolean };

async function checkedMember(
	member: ParsedMember,
	checkPhoto: Deps['checkPhoto'],
	rokkaCopies: RokkaCopies
): Promise<CheckedMember> {
	if (member.photoCode === null) {
		// ws.parl.ch sent no code, but rokka still holds the portrait of the stored one
		const stored = rokkaCopies.get(member.id);
		return { member: stored ? { ...member, photoCode: stored } : member, keepStoredPhoto: false };
	}
	try {
		if (await checkPhoto(member.photoCode)) return { member, keepStoredPhoto: false };
		// rokka still holds the last good portrait, so the member stays in the game
		if (rokkaCopies.get(member.id) === member.photoCode) return { member, keepStoredPhoto: false };
		return { member: { ...member, photoCode: null }, keepStoredPhoto: false };
	} catch {
		// the photo service is unreachable: an outage must not erase the codes already stored
		return { member: { ...member, photoCode: null }, keepStoredPhoto: true };
	}
}

async function withCheckedPhotos(
	members: ParsedMember[],
	checkPhoto: Deps['checkPhoto'],
	rokkaCopies: RokkaCopies
): Promise<CheckedMember[]> {
	const checked: CheckedMember[] = new Array(members.length);
	let next = 0;

	async function worker() {
		while (next < members.length) {
			const index = next++;
			checked[index] = await checkedMember(members[index], checkPhoto, rokkaCopies);
		}
	}

	await Promise.all(Array.from({ length: PHOTO_CHECK_CONCURRENCY }, worker));
	return checked;
}

function storedRokkaCopies(db: Db): RokkaCopies {
	const rows = db.all<{ id: number; photo_code: string }>(sql`
		select id, photo_code from member where photo_hash is not null and photo_code is not null
	`);
	return new Map(rows.map((row) => [row.id, row.photo_code]));
}

async function syncedPhotos(
	db: Db,
	importId: number,
	syncPhotos: NonNullable<Deps['syncPhotos']>
): Promise<Pick<ImportOutcome, 'photos' | 'photosError'>> {
	let result: Pick<ImportOutcome, 'photos' | 'photosError'>;
	try {
		result = { photos: await syncPhotos() };
	} catch (error) {
		result = { photosError: error instanceof Error ? error.message : String(error) };
	}
	const summary = result.photos
		? Object.entries(result.photos)
				.map(([key, count]) => `${key} ${count}`)
				.join(', ')
		: `failed: ${result.photosError}`;
	db.run(sql`
		update roster_import set status = 'published', detail = detail || ${`; photos ${summary}`}
		where id = ${importId} and status = 'running'
	`);
	return result;
}

type LostPhotos = { refused: number; uncoded: number };

// members whose stored photo code this import would clear, split by cause
function lostPhotos(db: Db, parsed: ParsedMember[], checked: CheckedMember[]): LostPhotos {
	const clearedIds = checked
		.filter((entry) => entry.member.photoCode === null && !entry.keepStoredPhoto)
		.map((entry) => entry.member.id);
	if (clearedIds.length === 0) return { refused: 0, uncoded: 0 };
	const rows = db.all<{ id: number }>(sql`
		select id from member where photo_code is not null and id in ${list(clearedIds)}
	`);
	const lost = new Set(rows.map((row) => row.id));
	const uncoded = parsed.filter(
		(member) => member.photoCode === null && lost.has(member.id)
	).length;
	return { refused: lost.size - uncoded, uncoded };
}

function lostPhotosDetail({ refused, uncoded }: LostPhotos): string {
	const causes = [
		refused > 0 ? `photo check says no photo for ${refused}` : '',
		uncoded > 0 ? `ws.parl.ch sends no photo code for ${uncoded}` : ''
	].filter(Boolean);
	return `${causes.join(' and ')} members who had one; refusing to remove them`;
}

function closeImport(db: Db, id: number, status: 'rejected' | 'failed', detail: string): void {
	db.run(sql`
		update roster_import set status = ${status}, finished_at = ${new Date()}, detail = ${detail}
		where id = ${id} and status = 'running'
	`);
}

const LEASE_LOST = 'lease lost to a newer import';

// with a photo sync to follow, the import stays running, and so keeps its lease, until the sync is done
function publish(
	db: Db,
	importId: number,
	checked: CheckedMember[],
	counts: { national: number; states: number; withoutPhoto: number },
	detail: string,
	syncFollows: boolean
): void {
	const now = new Date();
	db.tx(() => {
		// an import that outlived its lease must not overwrite the roster of the one that took it over
		const own = db.get<{ status: string }>(
			sql`select status from roster_import where id = ${importId}`
		);
		if (own?.status !== 'running') throw new Error(LEASE_LOST);
		for (const { member, keepStoredPhoto } of checked) {
			db.run(sql`
				insert into member (id, first_name, last_name, gender, council, canton, party, photo_code, active, updated_at)
				values (
					${member.id}, ${member.firstName}, ${member.lastName}, ${member.gender},
					${member.council}, ${member.canton}, ${JSON.stringify(member.party)}, ${member.photoCode},
					1, ${now}
				)
				on conflict (id) do update set
					first_name = excluded.first_name,
					last_name = excluded.last_name,
					gender = excluded.gender,
					council = excluded.council,
					canton = excluded.canton,
					party = excluded.party,
					photo_code = case when ${keepStoredPhoto} then member.photo_code else excluded.photo_code end,
					active = 1,
					updated_at = ${now}
			`);
		}
		db.run(sql`
			update member set active = 0, updated_at = ${now}
			where active and id not in ${list(checked.map(({ member }) => member.id))}
		`);
		db.run(sql`
			update roster_import set
				status = ${syncFollows ? 'running' : 'published'}, finished_at = ${now},
				national = ${counts.national}, states = ${counts.states},
				without_photo = ${counts.withoutPhoto}, detail = ${detail}
			where id = ${importId}
		`);
	});
}

const leaseFromNow = () => new Date(Date.now() + IMPORT_LEASE_MS);

// one write transaction, so two processes sharing the file cannot both take the lease; an import
// that died after publishing keeps its roster as published, only its photo sync is lost
function claimLease(db: Db): number | null {
	const now = new Date();
	return db.tx(() => {
		const running = db.get(sql`
			select id from roster_import where status = 'running' and lease_until > ${now}
		`);
		if (running) return null;
		db.run(sql`
			update roster_import set
				status = case when national is null then 'failed' else 'published' end,
				finished_at = coalesce(finished_at, ${now}),
				detail = case when national is null then 'interrupted' else detail || '; photos interrupted' end
			where status = 'running'
		`);
		const row = db.get<{ id: number }>(sql`
			insert into roster_import (status, started_at, lease_until)
			values ('running', ${now}, ${leaseFromNow()}) returning id
		`);
		return row!.id;
	});
}

export async function importRoster(db: Db, deps: Deps): Promise<ImportOutcome> {
	const id = claimLease(db);
	if (id === null) return { status: 'skipped' };
	// a renewal that fails is tried again at the next tick; a lease that runs out fails the publish,
	// whereas an error thrown from the timer would end the whole process
	const renewal = setInterval(() => {
		try {
			db.run(sql`
				update roster_import set lease_until = ${leaseFromNow()}
				where id = ${id} and status = 'running'
			`);
		} catch (cause) {
			console.warn(`roster import lease not renewed: ${String(cause)}`);
		}
	}, LEASE_RENEW_MS);
	renewal.unref();

	try {
		const raw = await deps.fetchSnapshot();
		const { members: parsed, problems, incomplete } = parseSnapshot(raw);
		const validation = validateSnapshot(parsed);
		const reasons = [...problems, ...(validation.ok ? [] : validation.reasons)];
		if (reasons.length > 0) {
			const detail = reasons.join('; ');
			closeImport(db, id, 'rejected', detail);
			return { status: 'rejected', detail };
		}

		const checked = await withCheckedPhotos(parsed, deps.checkPhoto, storedRokkaCopies(db));
		const lost = lostPhotos(db, parsed, checked);
		const lostCount = lost.refused + lost.uncoded;
		if (lostCount > Math.max(MIN_PHOTO_LOSS_LIMIT, PHOTO_LOSS_LIMIT_SHARE * parsed.length)) {
			const detail = lostPhotosDetail(lost);
			closeImport(db, id, 'rejected', detail);
			return { status: 'rejected', detail };
		}
		const photoErrors = checked.filter((entry) => entry.keepStoredPhoto).length;
		const counts = {
			national: parsed.filter((member) => member.council === 'N').length,
			states: parsed.filter((member) => member.council === 'S').length,
			withoutPhoto: checked.filter(
				(entry) => entry.member.photoCode === null && !entry.keepStoredPhoto
			).length
		};
		const detail =
			`de records ${raw.de.length}, parsed ${parsed.length}` +
			(incomplete > 0 ? `, incomplete ${incomplete}` : '') +
			(photoErrors > 0 ? `, photo checks failed ${photoErrors}, kept stored codes` : '');
		publish(db, id, checked, counts, detail, Boolean(deps.syncPhotos));
		const photos = deps.syncPhotos ? await syncedPhotos(db, id, deps.syncPhotos) : {};
		return { status: 'published', ...counts, detail, ...photos };
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		closeImport(db, id, 'failed', detail);
		return { status: 'failed', detail };
	} finally {
		clearInterval(renewal);
	}
}
