import type { CouncilChoice, Revealed } from '$lib/game/protocol';
import type { RosterEntry } from '$lib/cantons';
import type { Language } from '$lib/i18n';
import type { Candidate } from '../game/deal';
import { list, sql, toDate, type Db } from './sqlite';

type Party = Record<string, string>;

const partyIn = (party: string, language: Language): string => {
	const names: Party = JSON.parse(party);
	return names[language] ?? names.de ?? '';
};

export async function activeMemberCounts(db: Db): Promise<{ national: number; states: number }> {
	const row = db.get<{ national: number; states: number }>(sql`
		select
			count(*) filter (where council = 'N') as national,
			count(*) filter (where council = 'S') as states
		from member
		where active
	`)!;
	return { national: row.national, states: row.states };
}

export async function playableMemberCount(db: Db): Promise<number> {
	const row = db.get<{ count: number }>(sql`
		select count(*) as count from member where active and photo_code is not null
	`)!;
	return row.count;
}

// national is only set by a publish, which counts even while its photo sync still runs
export async function lastPublishedAt(db: Db): Promise<Date | null> {
	const row = db.get<{ published_at: number | null }>(sql`
		select max(finished_at) as published_at from roster_import where national is not null
	`)!;
	return toDate(row.published_at);
}

export async function playableMembers(db: Db, council: CouncilChoice): Promise<Candidate[]> {
	const rows = db.all<{ id: number; gender: Candidate['gender']; photo_code: string }>(sql`
		select id, gender, photo_code
		from member
		where active
			and photo_code is not null
			-- a placeholder with no portrait of theirs on rokka would be a round of a silhouette
			and not (photo_placeholder and photo_hash is null)
			and (${council} = 'all' or council = ${council})
		order by id
	`);
	return rows.map((row) => ({ id: row.id, gender: row.gender, photoCode: row.photo_code }));
}

export async function membersByIds(
	db: Db,
	ids: number[],
	language: Language
): Promise<Map<number, Revealed>> {
	if (ids.length === 0) return new Map();

	const rows = db.all<{
		id: number;
		first_name: string;
		last_name: string;
		canton: string;
		party: string;
	}>(sql`
		select id, first_name, last_name, canton, party
		from member
		where id in ${list(ids)}
	`);
	return new Map(
		rows.map((row) => [
			row.id,
			{
				id: row.id,
				firstName: row.first_name,
				lastName: row.last_name,
				party: partyIn(row.party, language),
				canton: row.canton
			}
		])
	);
}

export async function activeRoster(db: Db, language: Language): Promise<RosterEntry[]> {
	const rows = db.all<{
		id: number;
		photo_code: string | null;
		council: RosterEntry['council'];
		canton: string;
		first_name: string;
		last_name: string;
		party: string;
	}>(sql`
		select id, photo_code, council, canton, first_name, last_name, party from member where active
	`);
	return rows.map((row) => ({
		id: row.id,
		hasPhoto: row.photo_code !== null,
		council: row.council,
		canton: row.canton,
		firstName: row.first_name,
		lastName: row.last_name,
		party: partyIn(row.party, language)
	}));
}

export async function memberPhoto(
	db: Db,
	id: number
): Promise<{ code: string; hash: string | null } | null> {
	const row = db.get<{ photo_code: string; photo_hash: string | null }>(sql`
		select photo_code, photo_hash from member where id = ${id} and active and photo_code is not null
	`);
	return row ? { code: row.photo_code, hash: row.photo_hash } : null;
}
