import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { sql, type Db } from '$lib/server/db/sqlite';
import { isDecodable } from '$lib/server/photo/source';

const CONCURRENCY = 8;
const MIN_SIDE = 100;
const RETRY_DELAY_MS = 2_000;

export type PhotoSyncOutcome = {
	unchanged: number;
	uploaded: number;
	missing: number;
	held: number;
	failed: number;
};

type Deps = {
	// null: parlament.ch has no portrait for this code; a throw: it could not be told
	download: (code: string) => Promise<Buffer | null>;
	upload: (image: Buffer) => Promise<string>;
	wait?: (ms: number) => Promise<void>;
};

type Row = { id: number; photo_code: string; photo_sha1: string | null };
type Fetched = { row: Row; image: Buffer; sha1: string };

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function inParallel<T>(items: T[], work: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	const worker = async () => {
		while (next < items.length) await work(items[next++]);
	};
	await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

async function assertPortrait(image: Buffer): Promise<void> {
	if (!(await isDecodable(image))) throw new Error('does not decode');
	const { width = 0, height = 0 } = await sharp(image).metadata();
	if (width < MIN_SIDE || height < MIN_SIDE) throw new Error(`too small (${width}x${height})`);
}

// every way out of here keeps the copy already on rokka, so a bad day upstream never replaces a good photo
export async function syncPhotos(db: Db, deps: Deps): Promise<PhotoSyncOutcome> {
	const wait = deps.wait ?? sleep;
	const rows = db.all<Row>(sql`
		select id, photo_code, photo_sha1 from member where active and photo_code is not null
	`);
	const outcome: PhotoSyncOutcome = { unchanged: 0, uploaded: 0, missing: 0, held: 0, failed: 0 };
	const keep = (key: keyof PhotoSyncOutcome, code: string, reason: string) => {
		outcome[key]++;
		console.warn(`photo sync: ${code} kept its stored copy: ${reason}`);
	};

	const fetched: Fetched[] = [];
	await inParallel(rows, async (row) => {
		try {
			const image = await deps.download(row.photo_code);
			if (!image) return keep('missing', row.photo_code, 'parlament.ch has no portrait');
			fetched.push({ row, image, sha1: createHash('sha1').update(image).digest('hex') });
		} catch (error) {
			keep('failed', row.photo_code, reasonOf(error));
		}
	});

	const owners = new Map<string, number>();
	for (const { sha1 } of fetched) owners.set(sha1, (owners.get(sha1) ?? 0) + 1);
	const shared = [...owners].filter(([, count]) => count > 1).map(([sha1]) => sha1);
	if (shared.length > 0) {
		const seenAt = new Date();
		db.tx(() => {
			for (const sha1 of shared) {
				db.run(sql`
					insert into photo_placeholder (sha1, seen_at) values (${sha1}, ${seenAt})
					on conflict (sha1) do nothing
				`);
			}
		});
	}
	const placeholders = new Set(
		db.all<{ sha1: string }>(sql`select sha1 from photo_placeholder`).map((row) => row.sha1)
	);

	const upload = async (image: Buffer) => {
		try {
			return await deps.upload(image);
		} catch {
			await wait(RETRY_DELAY_MS);
			return deps.upload(image);
		}
	};

	await inParallel(fetched, async ({ row, image, sha1 }) => {
		// the same file for several members is a placeholder, not anybody's portrait
		if (placeholders.has(sha1)) {
			db.run(sql`update member set photo_placeholder = 1 where id = ${row.id}`);
			return keep('held', row.photo_code, 'shared by several members');
		}
		db.run(sql`update member set photo_placeholder = 0 where id = ${row.id} and photo_placeholder`);
		if (sha1 === row.photo_sha1) {
			outcome.unchanged++;
			return;
		}
		try {
			await assertPortrait(image);
			const hash = await upload(image);
			db.run(sql`
				update member set photo_hash = ${hash}, photo_sha1 = ${sha1}
				where id = ${row.id} and photo_code = ${row.photo_code}
			`);
			outcome.uploaded++;
		} catch (error) {
			keep('failed', row.photo_code, reasonOf(error));
		}
	});

	return outcome;
}
