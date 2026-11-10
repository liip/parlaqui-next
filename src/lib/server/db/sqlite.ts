import Database from 'better-sqlite3';
import { zurichDay } from '../zurich';

type Param = string | number | bigint | Buffer | null;
type Value = Param | boolean | Date | undefined;
type Row = Record<string, unknown>;

class Query {
	constructor(
		readonly text: string,
		readonly params: Param[]
	) {}
}

const toParam = (value: Value): Param => {
	if (value === undefined) return null;
	if (typeof value === 'boolean') return value ? 1 : 0;
	if (value instanceof Date) return value.getTime();
	return value;
};

// values become ? parameters; a nested query is spliced in with its own parameters
export function sql(strings: TemplateStringsArray, ...values: (Value | Query)[]): Query {
	let text = strings[0];
	const params: Param[] = [];
	values.forEach((value, i) => {
		if (value instanceof Query) {
			text += value.text;
			params.push(...value.params);
		} else {
			text += '?';
			params.push(toParam(value));
		}
		text += strings[i + 1];
	});
	return new Query(text, params);
}

// a parenthesised list for `in`; SQLite reads `in ()` as matching nothing
export const list = (values: Value[]): Query =>
	new Query(`(${values.map(() => '?').join(', ')})`, values.map(toParam));

export const toDate = (value: unknown): Date | null =>
	value === null || value === undefined ? null : new Date(value as number);

export const toBool = (value: unknown): boolean | null =>
	value === null || value === undefined ? null : value === 1;

const STATEMENT_CACHE = 500;

export class Db {
	readonly raw: Database.Database;
	private readonly statements = new Map<string, Database.Statement>();

	constructor(path: string) {
		this.raw = new Database(path);
		this.raw.pragma('journal_mode = WAL');
		this.raw.pragma('synchronous = NORMAL');
		this.raw.pragma('foreign_keys = ON');
		// a second process, such as the old container during a deploy, waits instead of failing
		this.raw.pragma('busy_timeout = 5000');
		this.raw.function('zurich_day', { deterministic: true }, (ms) =>
			ms === null ? null : zurichDay(Number(ms))
		);
	}

	private prepare(text: string): Database.Statement {
		const cached = this.statements.get(text);
		if (cached) return cached;
		if (this.statements.size >= STATEMENT_CACHE) this.statements.clear();
		const statement = this.raw.prepare(text);
		this.statements.set(text, statement);
		return statement;
	}

	all<T = Row>(query: Query): T[] {
		return this.prepare(query.text).all(...query.params) as T[];
	}

	get<T = Row>(query: Query): T | undefined {
		return this.prepare(query.text).get(...query.params) as T | undefined;
	}

	// the number of rows changed
	run(query: Query): number {
		return this.prepare(query.text).run(...query.params).changes;
	}

	exec(text: string): void {
		this.raw.exec(text);
	}

	// takes the write lock up front; fn must not await, or other requests would run inside it
	tx<T>(fn: () => T): T {
		return this.raw.transaction(fn).immediate();
	}

	close(): void {
		this.raw.close();
	}
}
