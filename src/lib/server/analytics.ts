import { createHash, randomBytes } from 'node:crypto';
import { isLanguage, type Language } from '$lib/i18n';
import { sql, type Db } from './db/sqlite';
import { endOfZurichDay, startOfZurichDay, zurichDay } from './zurich';

type PageKind = 'home' | 'members';
type Device = 'mobile' | 'desktop';
type View = { page: PageKind; language: Language; device: Device; referrer: string };

const BOT =
	/bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|slack|discord|embedly|curl|wget|python|headless|lighthouse/i;
const MOBILE = /mobi|android|iphone|ipad/i;
const RETENTION_DAYS = 400;

export const dayOf = (now: Date): string => zurichDay(now);

// calendar arithmetic on a day written YYYY-MM-DD, free of any time zone
const daysBefore = (day: string, days: number): string =>
	new Date(Date.parse(`${day}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

// null for anything that is not a person opening a page worth counting
export function viewOf(request: Request, url: URL): View | null {
	if (request.method !== 'GET') return null;
	if (request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1') return null;
	const agent = request.headers.get('user-agent') ?? '';
	if (!agent || BOT.test(agent)) return null;

	const data = url.pathname.endsWith('/__data.json');
	const [, language, section, rest] = url.pathname.replace(/\/__data\.json$/, '').split('/');
	if (!isLanguage(language)) return null;
	let page: PageKind;
	if (section === undefined) page = 'home';
	else if (section === 'members' && rest === undefined) page = 'members';
	else return null;

	return {
		page,
		language,
		device: MOBILE.test(agent) ? 'mobile' : 'desktop',
		referrer: data ? '' : referrerHost(request.headers.get('referer'), url.host)
	};
}

// stands for a referrer that is present but is no public host name worth naming
export const OTHER_REFERRER = 'other';

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// a name with a dot and a top-level label that is not a number, so never an IP address
function isPublicHost(host: string): boolean {
	const labels = host.split('.');
	return (
		host.length <= 253 &&
		labels.length > 1 &&
		labels.every((label) => LABEL.test(label)) &&
		!/^\d+$/.test(labels.at(-1)!)
	);
}

function referrerHost(referer: string | null, ownHost: string): string {
	if (!referer) return '';
	let from: URL;
	try {
		from = new URL(referer);
	} catch {
		return OTHER_REFERRER;
	}
	if (from.host === ownHost) return '';
	const hostname = from.hostname.toLowerCase();
	if (from.port || !isPublicHost(hostname)) return OTHER_REFERRER;
	const host = hostname.replace(/^www\./, '');
	return host === ownHost ? '' : host;
}

// counts at most `limit` views per address and day, so a script can neither inflate the
// figures nor fill the tables; the least recently seen address goes when the map is full
export function createViewCap({ limit, maxKeys }: { limit: number; maxKeys: number }) {
	let today = '';
	const seen = new Map<string, number>();

	return (day: string, address: string): boolean => {
		if (day !== today) {
			today = day;
			seen.clear();
		}
		const views = seen.get(address) ?? 0;
		seen.delete(address);
		seen.set(address, Math.min(views + 1, limit + 1));
		if (seen.size > maxKeys) seen.delete(seen.keys().next().value!);
		return views < limit;
	};
}

let salt = { day: '', value: Buffer.alloc(0) };

// the salt never leaves memory and changes every day, so a stored hash cannot be traced back
export function fingerprint(day: string, address: string, agent: string): Buffer {
	if (salt.day !== day) salt = { day, value: randomBytes(32) };
	return createHash('sha256')
		.update(salt.value)
		.update(address)
		.update('\0')
		.update(agent)
		.digest();
}

export async function recordView(
	db: Db,
	{ view, day, visitor }: { view: View; day: string; visitor: Buffer }
): Promise<void> {
	db.run(sql`
		insert into page_view (day, page, language, referrer, device, views)
		values (${day}, ${view.page}, ${view.language}, ${view.referrer}, ${view.device}, 1)
		on conflict (day, page, language, referrer, device) do update set views = page_view.views + 1
	`);
	db.run(sql`
		insert into visitor_day (day, fingerprint) values (${day}, ${visitor}) on conflict do nothing
	`);
}

export async function pruneAnalytics(db: Db, day: string): Promise<void> {
	const oldest = daysBefore(day, RETENTION_DAYS);
	db.run(sql`delete from visitor_day where day < ${oldest}`);
	db.run(sql`delete from page_view where day < ${oldest}`);
	db.run(sql`delete from games_started_day where day < ${oldest}`);
}

// in the transaction that creates the game; a game deleted later stays counted
export function countGameStarted(db: Db, day: string): void {
	db.run(sql`
		insert into games_started_day (day, started) values (${day}, 1)
		on conflict (day) do update set started = games_started_day.started + 1
	`);
}

type Insights = {
	from: string;
	to: string;
	days: {
		day: string;
		visitors: number;
		views: Record<PageKind, number>;
		gamesStarted: number;
		gamesFinished: number;
	}[];
	referrers: { host: string; views: number }[];
	languages: Record<string, number>;
	devices: Record<string, number>;
};

export const insightsSpan = (days: string | null): number =>
	Math.min(Math.max(Number(days) || 30, 1), RETENTION_DAYS);

const dayRange = (from: string, to: string): string[] => {
	const days: string[] = [];
	for (
		let day = new Date(`${from}T12:00:00Z`);
		dayOf(day) <= to;
		day = new Date(day.getTime() + 86_400_000)
	) {
		days.push(dayOf(day));
	}
	return days;
};

type DayCount = { day: string; count: number; page?: PageKind };
type Split = { key: string; views: number };

// a few grouped queries whatever the span: one pass over each table, never one per day
export async function insights(db: Db, now: Date, span = 30): Promise<Insights> {
	const to = dayOf(now);
	const from = daysBefore(to, span - 1);
	const visitors = db.all<DayCount>(sql`
		select day, count(*) as count from visitor_day
		where day between ${from} and ${to} group by day
	`);
	const views = db.all<DayCount>(sql`
		select day, page, sum(views) as count from page_view
		where day between ${from} and ${to} group by day, page
	`);
	const started = db.all<DayCount>(sql`
		select day, started as count from games_started_day where day between ${from} and ${to}
	`);
	const finished = db.all<DayCount>(sql`
		select zurich_day(finished_at) as day, count(*) as count
		from game
		where finished_at >= ${startOfZurichDay(from)} and finished_at < ${endOfZurichDay(to)}
		group by 1
	`);
	const referrers = db.all<{ host: string; views: number }>(sql`
		select referrer as host, sum(views) as views from page_view
		where day between ${from} and ${to} and referrer <> ''
		group by referrer order by views desc, referrer limit 20
	`);
	const languages = db.all<Split>(sql`
		select language as key, sum(views) as views from page_view
		where day between ${from} and ${to} group by language
	`);
	const devices = db.all<Split>(sql`
		select device as key, sum(views) as views from page_view
		where day between ${from} and ${to} group by device
	`);

	const count = (rows: DayCount[], day: string, page?: PageKind) =>
		rows
			.filter((row) => row.day === day && (page === undefined || row.page === page))
			.reduce((sum, row) => sum + row.count, 0);
	const split = (rows: Split[]) => Object.fromEntries(rows.map((row) => [row.key, row.views]));

	return {
		from,
		to,
		days: dayRange(from, to).map((day) => ({
			day,
			visitors: count(visitors, day),
			views: {
				home: count(views, day, 'home'),
				members: count(views, day, 'members')
			},
			gamesStarted: count(started, day),
			gamesFinished: count(finished, day)
		})),
		referrers: referrers.map((row) => ({ host: row.host, views: row.views })),
		languages: split(languages),
		devices: split(devices)
	};
}
