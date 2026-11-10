import { env } from '$env/dynamic/private';
import { redirect, type Handle, type RequestEvent, type ServerInit } from '@sveltejs/kit';
import { isLanguage } from '$lib/i18n';
import {
	createViewCap,
	dayOf,
	fingerprint,
	pruneAnalytics,
	recordView,
	viewOf
} from '$lib/server/analytics';
import { createDailyTask, repeat } from '$lib/server/daily';
import { pruneAbandonedGames, pruneVisitors } from '$lib/server/retention';
import { BACKUP_PATH, db } from '$lib/server/db';
import { snapshot } from '$lib/server/db/backup';
import { migration } from '$lib/server/db/ready';
import { addressBucket, createLimiter, createRefusalTally } from '$lib/server/rate-limit';
import { importDeps, importIfStale } from '$lib/server/roster/run';
import { VISITOR_COOKIE, findVisitor, hashOf } from '$lib/server/visitor';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

// the healthcheck calls the application here, and redirecting it to the canonical name sends the
// request out through the firewall, which answers Forbidden to the server itself
const internal = (host: string) => LOOPBACK.has(host.replace(/:\d+$/, '').replace(/^\[|\]$/g, ''));

const HEALTH_PATH = '/healthz';

// addresses of the old site that links and shared previews still point at
const LEGACY_PATHS: Record<string, string> = {
	'/index.html': '/',
	'/parlament.jpg': '/images/og.jpg'
};

// built on ORIGIN with the leading slashes folded into one, so a path like //evil.example or
// /\evil.example can never become the host of the target
function canonical(url: URL, origin: string): URL {
	const target = new URL(origin);
	target.pathname = url.pathname.replace(/^[/\\]+/, '/');
	target.search = url.search;
	return target;
}

type Resolve = Parameters<Handle>[0]['resolve'];

// the router decodes the path before it picks a route, so every check here reads the same decoded
// path: compared raw, /%61pi/game reached the game API without meeting a single limit
function decodedPath(pathname: string): string | null {
	try {
		return pathname.split('%25').map(decodeURI).join('%25');
	} catch {
		return null;
	}
}

const MINUTE = 60_000;
const TEN_MINUTES = 10 * MINUTE;
const HOUR = 60 * MINUTE;

// far above a human: a round takes at least about 1.3 s and costs three requests; one address can
// hold a whole school or office, so it gets thirty times a visitor's budget
const limits = {
	visitorStarts: createLimiter({ limit: 60, windowMs: TEN_MINUTES }),
	visitorTraffic: createLimiter({ limit: 300, windowMs: MINUTE }),
	addressStarts: createLimiter({ limit: 1800, windowMs: TEN_MINUTES }),
	addressTraffic: createLimiter({ limit: 9000, windowMs: MINUTE }),
	// the members page alone loads 246 portraits; after the first render they are cheap and the
	// browser keeps them for a day
	addressPortraits: createLimiter({ limit: 10_000, windowMs: MINUTE }),
	// a whole class can finish at once behind one address, each end screen drawing its image
	addressShares: createLimiter({ limit: 1200, windowMs: MINUTE }),
	// every start without a known device makes a new one, and each device weighs once in the
	// percentile, so new devices are capped well below starts; a school class fits many times over
	addressNewVisitors: createLimiter({ limit: 100, windowMs: HOUR }),
	// a person types the audience token a few times at most; a script guessing it gets nowhere
	insightsLogins: createLimiter({ limit: 10, windowMs: TEN_MINUTES })
};

type LimitName = keyof typeof limits;

const refusals = createRefusalTally();

function admit(name: LimitName, key: string, now: number): boolean {
	if (limits[name].hit(key, now)) return true;
	refusals.count(name);
	return false;
}

// the privacy page promises these deletions, so a failure is logged as such and retried
const dailyPrune = createDailyTask(
	async () => {
		await migration();
		const now = new Date();
		await pruneVisitors(db, now);
		await pruneAnalytics(db, dayOf(now));
	},
	{
		retryMs: TEN_MINUTES,
		onError: (cause) =>
			console.warn(`daily prune failed, tried again at the next hourly check: ${String(cause)}`)
	}
);

// a copy of the live file may be torn, or miss what is still in its write-ahead log
const dailyBackup = createDailyTask(
	async () => {
		if (BACKUP_PATH) await snapshot(db, BACKUP_PATH);
	},
	{
		retryMs: TEN_MINUTES,
		onError: (cause) =>
			console.warn(`daily backup failed, tried again at the next hourly check: ${String(cause)}`)
	}
);

// fetched by the server itself, so the platform needs no scheduler; a new database gets its roster at
// the first start
const dailyImport = createDailyTask(
	async () => {
		await migration();
		if (!env.PARL_API_KEY) return;
		const deps = importDeps(db, env.PARL_API_KEY, env.ROKKA_API_KEY);
		const outcome = await importIfStale(db, deps, new Date());
		if (outcome) console.info(`roster import ${outcome.status}: ${outcome.detail ?? ''}`);
	},
	{
		retryMs: TEN_MINUTES,
		onError: (cause) =>
			console.warn(`roster import failed, tried again at the next hourly check: ${String(cause)}`)
	}
);

const pruneAbandoned = (): void =>
	void (async () => {
		await migration();
		await pruneAbandonedGames(db, new Date());
	})().catch((cause) =>
		console.warn(`abandoned games not pruned, tried again in ten minutes: ${String(cause)}`)
	);

export const init: ServerInit = () => {
	// one line a minute at most, so a flood cannot flood the log as well
	setInterval(() => {
		const line = refusals.summary();
		if (line) console.warn(line);
	}, MINUTE).unref();
	// a missing proxy setting would put every visitor behind the proxy's one address
	console.info(
		env.ADDRESS_HEADER
			? `flood protection reads the visitor's address from the ${env.ADDRESS_HEADER} header`
			: "flood protection uses the connection's address (ADDRESS_HEADER is not set); behind a proxy every visitor shares one address"
	);
	// only the tests open the database in memory, and they choose when the prunes run
	if (env.DATABASE_PATH === ':memory:') return;
	// once at startup, then every hour; the task itself runs only once per Zurich day
	repeat(() => dailyPrune(dayOf(new Date()), Date.now()), HOUR);
	repeat(() => dailyBackup(dayOf(new Date()), Date.now()), HOUR);
	repeat(() => dailyImport(dayOf(new Date()), Date.now()), HOUR);
	// apart from the daily task, so an unfinished game is gone within ten minutes of its 24 hours
	// and not up to a day later, as the privacy page promises
	repeat(pruneAbandoned, TEN_MINUTES);
};

// per address bucket, like flood protection; a mobile carrier's NAT or a school network shares one
// IPv4 address among many people
const viewCap = createViewCap({ limit: 1000, maxKeys: 50_000 });

// a failed write is logged and never fails the page
function countView(event: RequestEvent): void {
	const view = viewOf(event.request, event.url);
	if (!view) return;
	const day = dayOf(new Date());
	let address = '';
	try {
		address = event.getClientAddress();
	} catch {
		address = '';
	}
	if (!viewCap(day, addressBucket(address))) return;
	const visitor = fingerprint(day, address, event.request.headers.get('user-agent') ?? '');
	void recordView(db, { view, day, visitor }).catch((cause) =>
		console.warn(`page view not counted: ${String(cause)}`)
	);
}

const isHealth = (path: string) => path === HEALTH_PATH || path.startsWith(`${HEALTH_PATH}/`);

// only the game API reads the visitor; media, files and the health check never do
const needsNoVisitor = (path: string) =>
	isHealth(path) ||
	path.startsWith('/photo/') ||
	path.startsWith('/portrait/') ||
	path.startsWith('/_app/') ||
	(/\.\w+$/.test(path) && !path.endsWith('/__data.json'));

const isGameTraffic = (path: string) => path.startsWith('/api/game/') || path.startsWith('/photo/');
// served to anyone without a cookie, and each first request costs an image render
const isShare = (path: string) => /^\/[a-z]{2}\/s\//.test(path);

const tooFast = (windowMs: number) =>
	new Response(JSON.stringify({ message: 'game.tooFast' }), {
		status: 429,
		headers: {
			'content-type': 'application/json',
			'retry-after': String(Math.ceil(windowMs / 1000))
		}
	});

// keyed by the raw cookie, so the limiter needs no database; a made-up cookie still meets the
// address ceiling
const visitorKeyOf = (event: RequestEvent) => {
	const token = event.cookies.get(VISITOR_COOKIE);
	return token ? hashOf(token).toString('base64url') : null;
};

const UNKNOWN_ADDRESS = 'unknown';
let addressWarned = false;

// adapter-node throws when ADDRESS_HEADER names a header the request does not carry
function addressOf(event: RequestEvent): string {
	try {
		return addressBucket(event.getClientAddress());
	} catch (cause) {
		if (!addressWarned) {
			addressWarned = true;
			console.warn(`flood protection cannot read the visitor's address: ${String(cause)}`);
		}
		return UNKNOWN_ADDRESS;
	}
}

function overLimit(event: RequestEvent, path: string): Response | null {
	const startsGame = event.request.method === 'POST' && path === '/api/game';
	if (event.request.method === 'POST' && path === '/insights/login') {
		return admit('insightsLogins', addressOf(event), Date.now()) ? null : tooFast(TEN_MINUTES);
	}
	if (path.startsWith('/portrait/')) {
		return admit('addressPortraits', addressOf(event), Date.now()) ? null : tooFast(MINUTE);
	}
	if (isShare(path)) {
		return admit('addressShares', addressOf(event), Date.now()) ? null : tooFast(MINUTE);
	}
	if (!startsGame && !isGameTraffic(path)) return null;

	const address = addressOf(event);
	const visitor = visitorKeyOf(event);
	const now = Date.now();
	const allowed = (byVisitor: LimitName, byAddress: LimitName) =>
		(!visitor || admit(byVisitor, visitor, now)) && admit(byAddress, address, now);

	if (startsGame && !allowed('visitorStarts', 'addressStarts')) {
		return tooFast(TEN_MINUTES);
	}
	if (isGameTraffic(path) && !allowed('visitorTraffic', 'addressTraffic')) {
		return tooFast(MINUTE);
	}
	return null;
}

const isInsights = (path: string) => path === '/insights' || path.startsWith('/insights/');

function secure(headers: Headers, path: string): void {
	if (env.ORIGIN?.startsWith('https:')) {
		headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
	}
	headers.set('x-content-type-options', 'nosniff');
	headers.set('referrer-policy', 'strict-origin-when-cross-origin');
	headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
	// the audience figures must not stay in a shared or back-button cache
	if (isInsights(path)) headers.set('cache-control', 'private, no-store');
}

const COMPRESSIBLE = /^(text\/(html|plain|xml)|application\/xml)\b/;

// gzip, or the * wildcard, with a weight above zero: q=0 refuses it
function takesGzip(header: string): boolean {
	const weights = new Map<string, number>();
	for (const part of header.toLowerCase().split(',')) {
		const [name, ...params] = part.split(';').map((piece) => piece.trim());
		const q = params.find((param) => param.startsWith('q='));
		weights.set(name, q ? Number(q.slice(2)) : 1);
	}
	return (weights.get('gzip') ?? weights.get('*') ?? 0) > 0;
}

// the cluster's ingress sends pages as they come, and the members page is 100 KB of HTML
function compressed(request: Request, response: Response): Response {
	const type = response.headers.get('content-type') ?? '';
	if (!response.body || response.headers.has('content-encoding') || !COMPRESSIBLE.test(type)) {
		return response;
	}
	response.headers.append('vary', 'Accept-Encoding');
	if (!takesGzip(request.headers.get('accept-encoding') ?? '')) return response;
	const headers = new Headers(response.headers);
	headers.set('content-encoding', 'gzip');
	headers.delete('content-length');
	// the validator names the plain bytes, which a gzipped body no longer has
	headers.delete('etag');
	return new Response(response.body.pipeThrough(new CompressionStream('gzip')), {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

async function serve(event: RequestEvent, resolve: Resolve, path: string): Promise<Response> {
	// the health routes run the migrations themselves, so a database that is down answers 503, not 500
	if (isHealth(path)) return resolve(event);

	const refused = overLimit(event, path);
	if (refused) return refused;

	await migration();

	event.locals.visitorId = needsNoVisitor(path)
		? null
		: await findVisitor(db, event.cookies.get(VISITOR_COOKIE));
	// after the lookup, so a made-up cookie counts as the new device it is about to become
	const mintsVisitor =
		event.request.method === 'POST' && path === '/api/game' && !event.locals.visitorId;
	if (mintsVisitor && !admit('addressNewVisitors', addressOf(event), Date.now())) {
		return tooFast(HOUR);
	}

	const first = path.split('/')[1];
	// the audience pages are written in French only
	const lang = isLanguage(first) ? first : first === 'insights' ? 'fr' : 'de';

	const response = await resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%lang%', lang)
	});
	if (response.status === 200) countView(event);
	// the game page renders in the browser only, so a header is the noindex every crawler sees
	if (isLanguage(first) && path.split('/')[2] === 'game') {
		response.headers.set('x-robots-tag', 'noindex');
	}
	return response;
}

export const handle: Handle = async ({ event, resolve }) => {
	const path = decodedPath(event.url.pathname);
	// first, and answered without a throw: for a path the router cannot decode either, an error or a
	// redirect thrown from here is never caught, and the unhandled rejection ends the whole process
	if (path === null) return new Response('Malformed path', { status: 400 });

	// ORIGIN pins event.url, so only the raw headers still carry the host and scheme the visitor reached;
	// the cluster's ingress serves plain http too and leaves the upgrade to the app
	const arrivedAt = event.request.headers.get('host');
	const arrivedOver = event.request.headers.get('x-forwarded-proto');
	if (env.ORIGIN && arrivedAt && !internal(arrivedAt)) {
		const origin = new URL(env.ORIGIN);
		const plain = arrivedOver !== null && `${arrivedOver}:` !== origin.protocol;
		if (arrivedAt !== origin.host || plain) throw redirect(308, canonical(event.url, env.ORIGIN));
	}

	const legacy = LEGACY_PATHS[path];
	if (legacy) throw redirect(301, `${legacy}${event.url.search}`);

	const response = await serve(event, resolve, path);
	secure(response.headers, path);
	return compressed(event.request, response);
};

// adapter-node closes the server on SIGTERM and SIGINT, then emits this; closing the database folds
// the write-ahead log back into the file before the process ends
process.on('sveltekit:shutdown', () => db.close());
