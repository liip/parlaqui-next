import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testDb } from '../../../../test/db';
import { membersByIds, playableMembers } from './members';
import { sql, type Db } from './sqlite';

type Row = {
	id: number;
	council: 'N' | 'S';
	photoCode?: string | null;
	active?: boolean;
	party?: Record<string, string>;
};

describe('members queries', () => {
	let db: Db;

	async function insert({ id, council, photoCode = `p${id}`, active = true, party }: Row) {
		db.run(sql`
			insert into member (id, first_name, last_name, gender, council, canton, party, photo_code,
				active, updated_at)
			values (${id}, ${`First${id}`}, ${`Last${id}`}, 'f', ${council}, 'VD',
				${JSON.stringify(party ?? { de: 'SP', fr: 'PS' })}, ${photoCode}, ${active}, ${new Date()})
		`);
	}

	beforeEach(() => {
		db = testDb();
	});

	afterEach(() => db.close());

	describe('playableMembers', () => {
		beforeEach(async () => {
			await insert({ id: 1, council: 'N' });
			await insert({ id: 2, council: 'S' });
			await insert({ id: 3, council: 'N', active: false });
			await insert({ id: 4, council: 'S', photoCode: null });
		});

		it('leaves out inactive members and members without a photo', async () => {
			const ids = (await playableMembers(db, 'all')).map((m) => m.id);

			expect(ids).toEqual([1, 2]);
		});

		it('filters by council', async () => {
			expect((await playableMembers(db, 'N')).map((m) => m.id)).toEqual([1]);
			expect((await playableMembers(db, 'S')).map((m) => m.id)).toEqual([2]);
		});

		it('returns the fields a candidate needs', async () => {
			expect((await playableMembers(db, 'N'))[0]).toEqual({
				id: 1,
				gender: 'f',
				photoCode: 'p1'
			});
		});
	});

	describe('membersByIds', () => {
		it('returns the party in the requested language and the canton', async () => {
			await insert({ id: 1, council: 'N' });

			const members = await membersByIds(db, [1], 'fr');

			expect(members.get(1)).toEqual({
				id: 1,
				firstName: 'First1',
				lastName: 'Last1',
				party: 'PS',
				canton: 'VD'
			});
		});

		it('falls back to the German party when the language is missing', async () => {
			await insert({ id: 1, council: 'N' });

			expect((await membersByIds(db, [1], 'rm')).get(1)?.party).toBe('SP');
		});

		it('returns an empty map for no ids', async () => {
			expect((await membersByIds(db, [], 'de')).size).toBe(0);
		});
	});
});
