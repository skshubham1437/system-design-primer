import { describe, expect, it } from 'vitest';
import { DURATION_MS, SCENARIOS, SCHEMES, SERVERS, SETTINGS, arrivals, collisionChance, collisionTrials, drawIds, expectedDuplicates, formatId, generate, idsForChance, makeSnowflake, orderPoints, readSnowflake, summarizeIds, type Scenario, type Scheme } from '../../src/lib/unique-id';

const run = (s: Scheme, sc: Scenario, o = {}) => summarizeIds(s, generate(s, sc, o));

describe('ID schemes', () => {
  it('account for every request', () => {
    for (const s of SCHEMES) for (const sc of SCENARIOS) {
      const r = run(s, sc);
      expect(r.issued + r.failed, `${s} ${sc}`).toBe(r.requests);
      expect(r.requests).toBe(arrivals(sc).length);
    }
    expect(arrivals('normal')).toHaveLength(SERVERS * DURATION_MS);
  });

  it('in normal running nothing collides and nothing fails', () => {
    for (const s of SCHEMES) expect(run(s, 'normal'), s).toMatchObject({ duplicates: 0, failed: 0, maxWaitMs: 0 });
  });

  it('counters come out in order; UUIDv4 is scattered across the whole run; time-based IDs are ordered to the millisecond', () => {
    for (const s of ['auto-increment', 'ticket-servers'] as const) expect(run(s, 'normal'), s).toMatchObject({ outOfOrder: 0, worstGapMs: 0 });
    expect(run('uuid-v4', 'normal').worstGapMs).toBeGreaterThan(DURATION_MS * 0.9);
    for (const s of ['uuid-v7', 'snowflake'] as const) {
      const r = run(s, 'normal');
      expect(r.worstGapMs, s).toBe(0); // only inside one millisecond
      expect(r.outOfOrder, s).toBeGreaterThan(0);
    }
  });

  it('only the database schemes make a database call for an ID', () => {
    for (const s of SCHEMES) expect(run(s, 'normal').dbCalls, s).toBe(s === 'auto-increment' || s === 'ticket-servers' ? SERVERS * DURATION_MS : 0);
  });

  it('a clock moving back makes Snowflake wait; without the guard it issues duplicates', () => {
    const guarded = run('snowflake', 'clock-back');
    expect(guarded).toMatchObject({ duplicates: 0, maxWaitMs: SETTINGS.clockBackMs });
    expect(run('snowflake', 'clock-back', { clockGuard: false })).toMatchObject({ duplicates: SETTINGS.clockBackMs, maxWaitMs: 0 });
  });

  it('a clock moving back does not duplicate UUIDv7, whose random bits differ, but does disorder it', () => {
    expect(run('uuid-v7', 'clock-back')).toMatchObject({ duplicates: 0, maxWaitMs: 0, worstGapMs: SETTINGS.clockBackMs });
  });

  it('a clock that runs ahead puts time-based IDs out of order by the skew', () => {
    for (const s of ['uuid-v7', 'snowflake'] as const) expect(run(s, 'clock-skew').worstGapMs, s).toBe(SETTINGS.skewMs);
    for (const s of ['auto-increment', 'ticket-servers'] as const) expect(run(s, 'clock-skew').outOfOrder, s).toBe(0);
  });

  it('with the database down, auto-increment fails while ticket servers carry on, then come back out of order', () => {
    const lost = (SETTINGS.downTo - SETTINGS.downFrom) * SERVERS;
    expect(run('auto-increment', 'db-down')).toMatchObject({ failed: lost, duplicates: 0, outOfOrder: 0 });
    const t = run('ticket-servers', 'db-down');
    expect(t).toMatchObject({ failed: 0, duplicates: 0 });
    expect(t.worstGapMs).toBeGreaterThan(SETTINGS.downTo - SETTINGS.downFrom);
    for (const s of ['uuid-v4', 'uuid-v7', 'snowflake'] as const) expect(run(s, 'db-down').failed, s).toBe(0);
  });

  it('a stale failover reissues IDs from the database schemes only', () => {
    for (const s of ['auto-increment', 'ticket-servers'] as const) expect(run(s, 'stale-failover').duplicates, s).toBe(SETTINGS.failoverBehind);
    for (const s of ['uuid-v4', 'uuid-v7', 'snowflake'] as const) expect(run(s, 'stale-failover').duplicates, s).toBe(0);
  });

  it('two machines sharing a machine id collide every millisecond', () => {
    expect(run('snowflake', 'shared-worker').duplicates).toBe(DURATION_MS);
    for (const s of SCHEMES.filter((x) => x !== 'snowflake')) expect(run(s, 'shared-worker').duplicates, s).toBe(0);
  });

  it('a burst past 4,096 in a millisecond spills into the next one, without duplicates', () => {
    const issued = generate('snowflake', 'burst');
    const r = summarizeIds('snowflake', issued);
    expect(r).toMatchObject({ duplicates: 0, maxWaitMs: 1 });
    const inBurstMs = issued.filter((x) => x.server === SETTINGS.burstServer && x.waitMs === 0 && x.t === SETTINGS.burstAt);
    expect(inBurstMs).toHaveLength(4096);
    for (const x of issued) expect(readSnowflake(x.id!).sequence).toBeLessThanOrEqual(4095);
  });

  it('never issues a duplicate from one Snowflake machine, when configured properly, in any scenario', () => {
    for (const sc of SCENARIOS.filter((x) => x !== 'shared-worker')) expect(run('snowflake', sc).duplicates, sc).toBe(0);
  });

  it('is the same on every run', () => {
    for (const s of SCHEMES) expect(generate(s, 'normal')).toEqual(generate(s, 'normal'));
  });
});

describe('ID layouts', () => {
  it('a Snowflake ID packs and unpacks 41 + 10 + 12 bits, and fits in a signed 64-bit integer', () => {
    const maxTime = 2 ** 41 - 1;
    const id = makeSnowflake(maxTime, 1023, 4095);
    expect(readSnowflake(id)).toEqual({ timeMs: maxTime, worker: 1023, sequence: 4095 });
    expect(id).toBe(2n ** 63n - 1n);
    expect(2 ** 12).toBe(4096);
    expect(2 ** 10).toBe(1024);
    expect(Math.floor(2 ** 41 / (365.25 * 24 * 3600 * 1000))).toBe(69); // the README's 69 years
  });

  it('the UUIDs carry the version and variant of RFC 9562', () => {
    const v4 = formatId('uuid-v4', generate('uuid-v4', 'normal')[0].id);
    const v7 = formatId('uuid-v7', generate('uuid-v7', 'normal')[0].id);
    expect(v4).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(v7).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('points run from corner to corner for a counter, and show failures and duplicates', () => {
    const pts = orderPoints(generate('auto-increment', 'normal'));
    expect(pts.length).toBeGreaterThan(200);
    expect(pts.length).toBeLessThanOrEqual(310);
    for (const q of pts) expect(Math.abs(q.x - q.y)).toBeLessThan(0.001);
    expect(orderPoints(generate('auto-increment', 'db-down')).some((q) => q.failed)).toBe(true);
    expect(orderPoints(generate('snowflake', 'shared-worker')).some((q) => q.dup)).toBe(true);
  });
});

describe('random IDs and the birthday bound', () => {
  it('gives the figures in the Wikipedia table for 50%', () => {
    expect(idsForChance(2 ** 32) / 1e4).toBeCloseTo(7.7, 1);
    expect(idsForChance(2 ** 64) / 1e9).toBeCloseTo(5.1, 1);
  });

  it('agrees with itself: the count for 50% has a 50% chance', () => {
    for (const bits of [24, 32, 48, 64, 122]) expect(collisionChance(idsForChance(2 ** bits), 2 ** bits)).toBeCloseTo(0.5, 3);
  });

  it('agrees with real draws', () => {
    const space = 2 ** 24;
    const n = Math.round(idsForChance(space));
    const hits = collisionTrials(n, space, 200, 5);
    expect(hits).toBeGreaterThan(70);
    expect(hits).toBeLessThan(130);
    expect(collisionTrials(50, 2 ** 48, 20)).toBe(0);
  });

  it('finds every duplicate when the space is smaller than the draw', () => {
    const r = drawIds(1000, 10, 3);
    expect(r.duplicates).toBe(990);
    expect(r.firstAt).toBeLessThan(11 + 1);
  });

  it('stays accurate for tiny chances, where a plain 1 - e^x would round to 0', () => {
    expect(collisionChance(1e9, 2 ** 122)).toBeGreaterThan(0);
    expect(collisionChance(1e9, 2 ** 122)).toBeCloseTo(1e18 / (2 * 2 ** 122), 25);
  });
});
