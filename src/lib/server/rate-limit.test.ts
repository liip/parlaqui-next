import { describe, expect, it } from 'vitest';
import { addressBucket, createDailyCap, createLimiter, createRefusalTally } from './rate-limit';

describe('createLimiter', () => {
	it('allows up to the limit then refuses', () => {
		const limiter = createLimiter({ limit: 3, windowMs: 1000 });

		expect([1, 2, 3, 4].map((i) => limiter.hit('a', i))).toEqual([true, true, true, false]);
	});

	it('allows again once the window has passed', () => {
		const limiter = createLimiter({ limit: 2, windowMs: 1000 });
		limiter.hit('a', 0);
		limiter.hit('a', 100);

		expect(limiter.hit('a', 500)).toBe(false);
		expect(limiter.hit('a', 1000)).toBe(true);
		expect(limiter.hit('a', 1050)).toBe(false);
		expect(limiter.hit('a', 1100)).toBe(true);
	});

	it('counts keys separately', () => {
		const limiter = createLimiter({ limit: 1, windowMs: 1000 });

		expect(limiter.hit('a', 0)).toBe(true);
		expect(limiter.hit('b', 0)).toBe(true);
		expect(limiter.hit('a', 1)).toBe(false);
	});

	it('never holds more than maxKeys keys', () => {
		const limiter = createLimiter({ limit: 1, windowMs: 1000, maxKeys: 2 });
		limiter.hit('a', 0);
		limiter.hit('b', 1);
		limiter.hit('c', 2);

		expect(limiter.hit('b', 3)).toBe(false);
		expect(limiter.hit('c', 3)).toBe(false);
		expect(limiter.hit('a', 3)).toBe(true);
	});
});

describe('createDailyCap', () => {
	it('counts the first hits of a key each day and refuses the rest', () => {
		const admit = createDailyCap({ limit: 3, maxKeys: 10 });
		const day = '2026-11-30';
		const admitted = Array.from({ length: 5 }, () => admit(day, '203.0.113.7'));
		expect(admitted).toEqual([true, true, true, false, false]);
		expect(admit(day, '203.0.113.8')).toBe(true);
		expect(admit('2026-12-01', '203.0.113.7')).toBe(true);
	});

	it('keeps at most maxKeys keys, dropping the one seen longest ago', () => {
		const admit = createDailyCap({ limit: 1, maxKeys: 2 });
		const day = '2026-11-30';
		admit(day, 'a');
		admit(day, 'b');
		admit(day, 'a');
		admit(day, 'c');
		expect(admit(day, 'a')).toBe(false);
		expect(admit(day, 'b')).toBe(true);
	});
});

describe('createRefusalTally', () => {
	it('sums the refusals per limit into one line, then starts again from nothing', () => {
		const tally = createRefusalTally();
		expect(tally.summary()).toBeNull();

		tally.count('addressTraffic');
		tally.count('visitorStarts');
		tally.count('addressTraffic');

		expect(tally.summary()).toBe(
			'flood protection refused 3 requests in the last minute: addressTraffic 2, visitorStarts 1'
		);
		expect(tally.summary()).toBeNull();
	});
});

describe('addressBucket', () => {
	it('keeps an IPv4 address as it is', () => {
		expect(addressBucket('203.0.113.9')).toBe('203.0.113.9');
	});

	it('reads an IPv4-mapped IPv6 address as IPv4', () => {
		expect(addressBucket('::ffff:203.0.113.9')).toBe('203.0.113.9');
	});

	it.each([
		['2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'],
		['2001:db8:1:2::7', '2001:db8:1:2::/64'],
		['2001:0db8:0001:0002:ffff::', '2001:db8:1:2::/64'],
		['2001:db8::1', '2001:db8:0:0::/64'],
		['::1', '0:0:0:0::/64'],
		['fe80::1%eth0', 'fe80:0:0:0::/64'],
		['64:ff9b:1:2::203.0.113.9', '64:ff9b:1:2::/64']
	])('buckets %s by its /64 prefix', (address, bucket) => {
		expect(addressBucket(address)).toBe(bucket);
	});

	it('puts two addresses of one /64 in the same bucket', () => {
		expect(addressBucket('2001:db8:a:b:1::1')).toBe(addressBucket('2001:db8:a:b:ffff::2'));
	});
});
