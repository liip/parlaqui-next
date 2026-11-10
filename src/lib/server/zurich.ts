const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' });

const partsFormat = new Intl.DateTimeFormat('en-CA', {
	timeZone: 'Europe/Zurich',
	hourCycle: 'h23',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit'
});

// the Zurich day of an instant, written YYYY-MM-DD
export const zurichDay = (at: Date | number): string => dayFormat.format(at);

// how far Zurich's wall clock is ahead of UTC at an instant
function offsetMs(at: number): number {
	const parts = Object.fromEntries(
		partsFormat.formatToParts(at).map(({ type, value }) => [type, Number(value)])
	);
	const wall = Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
		parts.second
	);
	return wall - Math.floor(at / 1000) * 1000;
}

// the instant a Zurich wall-clock midnight falls on; the offset is read twice, since the first
// guess can land on the other side of a clock change
function zurichMidnight(year: number, month: number, day: number): Date {
	const wall = Date.UTC(year, month, day);
	const guess = wall - offsetMs(wall);
	return new Date(wall - offsetMs(guess));
}

// the first instant of a Zurich day written YYYY-MM-DD
export function startOfZurichDay(day: string): Date {
	const [year, month, date] = day.split('-').map(Number);
	return zurichMidnight(year, month - 1, date);
}

// the first instant of the next Zurich day after one written YYYY-MM-DD
export function endOfZurichDay(day: string): Date {
	const [year, month, date] = day.split('-').map(Number);
	return zurichMidnight(year, month - 1, date + 1);
}

// the Zurich month of an instant, as [first instant, first instant of the next month)
export function zurichMonth(at: Date): { start: Date; end: Date } {
	const [year, month] = zurichDay(at).split('-').map(Number);
	return { start: zurichMidnight(year, month - 1, 1), end: zurichMidnight(year, month, 1) };
}
