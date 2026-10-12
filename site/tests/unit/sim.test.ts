import { describe, expect, it } from 'vitest';
import { hash32, mulberry32, simulateCache, simulateLb, summarizeLb } from '../../src/lib/sim';

const hits = (steps: { hit: boolean }[]) => steps.filter((s) => s.hit).length;
const seq = (s: string) => s.split(' ');

describe('mulberry32 / hash32', () => {
  it('is deterministic for a seed and stays in [0, 1)', () => {
    const a = mulberry32(42), b = mulberry32(42);
    const xs = Array.from({ length: 50 }, () => a());
    expect(xs).toEqual(Array.from({ length: 50 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('hashes to unsigned 32-bit values and separates similar strings', () => {
    expect(hash32('key-1')).toBe(hash32('key-1'));
    expect(hash32('key-1')).not.toBe(hash32('key-2'));
    for (const k of ['', 'a', 'user:42']) {
      const h = hash32(k);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
    }
  });
});

describe('simulateCache', () => {
  it('LRU: re-touching a key protects it', () => {
    // cap 2: A B A C -> evicts B (A was touched), then B misses
    const steps = simulateCache('lru', seq('A B A C B'), 2);
    expect(steps.map((s) => s.hit)).toEqual([false, false, true, false, false]);
    expect(steps[3].evicted).toBe('B');
  });

  it('FIFO: ignores recency', () => {
    // same stream: FIFO evicts A (oldest insert) at the C miss
    const steps = simulateCache('fifo', seq('A B A C B'), 2);
    expect(steps[3].evicted).toBe('A');
    expect(steps.map((s) => s.hit)).toEqual([false, false, true, false, true]);
  });

  it('LFU keeps the frequently used key through a scan', () => {
    const steps = simulateCache('lfu', seq('A A A B C D'), 2);
    expect(steps[5].cache).toContain('A');
  });

  it('a loop one larger than the cache never hits under LRU or FIFO, but does under optimal', () => {
    const loop = seq(Array.from({ length: 30 }, (_, i) => 'ABCDE'[i % 5]).join(' '));
    expect(hits(simulateCache('lru', loop, 4))).toBe(0);
    expect(hits(simulateCache('fifo', loop, 4))).toBe(0);
    expect(hits(simulateCache('opt', loop, 4))).toBeGreaterThan(10);
  });

  it('optimal is an upper bound for every policy', () => {
    const r = mulberry32(9);
    const stream = Array.from({ length: 80 }, () => String.fromCharCode(65 + Math.floor(r() * 10)));
    const best = hits(simulateCache('opt', stream, 4));
    for (const p of ['lru', 'lfu', 'fifo', 'random'] as const) expect(hits(simulateCache(p, stream, 4))).toBeLessThanOrEqual(best);
  });

  it('never holds more than capacity', () => {
    const steps = simulateCache('random', seq('A B C D E F G A B C'), 3);
    expect(steps.every((s) => s.cache.length <= 3)).toBe(true);
  });

  it('is repeatable', () => {
    const a = simulateCache('random', seq('A B C D E A B C D E'), 3);
    const b = simulateCache('random', seq('A B C D E A B C D E'), 3);
    expect(a).toEqual(b);
  });
});

describe('simulateLb', () => {
  const uniform = [1, 1, 1, 1];
  const mixed = [1, 1, 2, 3];

  it('is deterministic', () => {
    expect(simulateLb('rr', uniform, false)).toEqual(simulateLb('rr', uniform, false));
  });

  it('round robin spreads request counts almost exactly evenly', () => {
    const r = simulateLb('rr', uniform, false);
    expect(Math.max(...r.served) - Math.min(...r.served)).toBeLessThanOrEqual(1);
  });

  it('weighted round robin matches round robin on identical servers', () => {
    expect(simulateLb('wrr', uniform, false).served).toEqual(simulateLb('rr', uniform, false).served);
  });

  it('weighted round robin gives faster servers proportionally more requests', () => {
    const r = simulateLb('wrr', mixed, false);
    expect(r.served[3]).toBeGreaterThan(r.served[0] * 2);
  });

  it('on mixed hardware, weighted beats plain round robin on tail latency', () => {
    expect(simulateLb('wrr', mixed, false).p95).toBeLessThan(simulateLb('rr', mixed, false).p95);
  });

  it('IP hash with one hot client is worse than least connections', () => {
    expect(simulateLb('hash', uniform, true).p95).toBeGreaterThan(simulateLb('least', uniform, true).p95);
  });

  it('least connections spreads requests evenly over identical servers (ties are not always given to server 1)', () => {
    const r = simulateLb('least', [1, 1, 1, 1, 1, 1], false);
    expect(Math.min(...r.served) / Math.max(...r.served)).toBeGreaterThan(0.6);
  });

  it('every algorithm sees the same traffic: routing choices do not change which requests arrive', () => {
    const total = (a: 'rr' | 'random' | 'least' | 'hash') => simulateLb(a, uniform, false).served.reduce((x, y) => x + y, 0);
    expect(new Set([total('rr'), total('random'), total('least'), total('hash')]).size).toBe(1);
  });

  it('summaries over many runs report a median inside the range of the runs', () => {
    const s = summarizeLb('rr', uniform, false);
    expect(s.runs).toBe(20);
    expect(s.p95).toBeGreaterThanOrEqual(s.p95Low);
    expect(s.p95).toBeLessThanOrEqual(s.p95High);
    expect(s.p95High).toBeGreaterThan(s.p95Low); // different traffic really does give different results
  });

  it('over many runs, least connections beats round robin and IP hash on tail latency', () => {
    for (const sp of [uniform, mixed]) {
      const least = summarizeLb('least', sp, false).p95;
      expect(least).toBeLessThan(summarizeLb('rr', sp, false).p95);
      expect(least).toBeLessThan(summarizeLb('hash', sp, false).p95);
    }
  });

  it('records one frame per tick with one entry per server', () => {
    const r = simulateLb('least', mixed, false);
    expect(r.frames).toHaveLength(160);
    expect(r.frames.every((f) => f.length === 4)).toBe(true);
  });
});
