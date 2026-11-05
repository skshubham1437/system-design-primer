import { describe, expect, it } from 'vitest';
import { ALGORITHMS, PATTERNS, limitRequests, summarize, traffic, type Algorithm } from '../../src/lib/rate-limit';

const p = { limit: 10, windowMs: 1000, burst: 10 };
const run = (algo: Algorithm, pattern: Parameters<typeof traffic>[0], params = p) =>
  summarize(limitRequests(traffic(pattern, params.limit, params.windowMs, 10_000), algo, params), params.windowMs);

describe('rate limiters', () => {
  it('account for every request: allowed plus rejected is what was sent', () => {
    for (const a of ALGORITHMS) for (const pat of PATTERNS) {
      const s = run(a, pat);
      expect(s.allowed + s.rejected, `${a} on ${pat}`).toBe(s.sent);
    }
  });

  it('a fixed window lets twice the limit through around a window boundary', () => {
    const s = run('fixed-window', 'boundary');
    expect(s.rejected).toBe(0);
    expect(s.peakInWindow).toBe(2 * p.limit);
  });

  it('a sliding log never serves more than the limit in any window, whatever the traffic', () => {
    for (const pat of PATTERNS) expect(run('sliding-log', pat).peakInWindow, pat).toBeLessThanOrEqual(p.limit);
  });

  it('a sliding counter stays close to the limit, far closer than a fixed window', () => {
    for (const pat of PATTERNS) expect(run('sliding-counter', pat).peakInWindow, pat).toBeLessThanOrEqual(p.limit * 1.2);
    expect(run('sliding-counter', 'boundary').peakInWindow).toBeLessThan(run('fixed-window', 'boundary').peakInWindow);
  });

  it('a token bucket allows a burst of up to its size on top of the refill, and no more', () => {
    for (const pat of PATTERNS) expect(run('token-bucket', pat).peakInWindow, pat).toBeLessThanOrEqual(p.burst + p.limit);
    // a full bucket of 20 swallows a burst of 20 that a window limit of 10 would cut in half
    const burst = Array.from({ length: 20 }, (_, i) => 5000 + i);
    expect(summarize(limitRequests(burst, 'token-bucket', { ...p, burst: 20 }), p.windowMs).allowed).toBe(20);
    expect(summarize(limitRequests(burst, 'sliding-log', p), p.windowMs).allowed).toBe(10);
  });

  it('a token bucket refills at the limit: over a long run it allows the limit per window plus one bucket', () => {
    const s = run('token-bucket', 'steady');
    expect(s.allowed).toBeLessThanOrEqual(10 * p.limit + p.burst);
    expect(s.allowed).toBeGreaterThanOrEqual(10 * p.limit);
  });

  it('a leaky bucket serves at a perfectly steady rate, and makes requests wait instead', () => {
    for (const pat of PATTERNS) {
      const d = limitRequests(traffic(pat, p.limit, p.windowMs, 10_000), 'leaky-bucket', p);
      const s = summarize(d, p.windowMs);
      expect(s.peakInWindow, pat).toBeLessThanOrEqual(p.limit);
      expect(s.maxWaitMs, pat).toBeLessThanOrEqual(p.burst * (p.windowMs / p.limit));
      const starts = d.filter((x) => x.allowed).map((x) => x.startMs);
      for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(p.windowMs / p.limit - 1e-9);
    }
    // the only limiter that delays
    for (const a of ALGORITHMS.filter((x) => x !== 'leaky-bucket')) expect(run(a, 'bursts').maxWaitMs).toBe(0);
  });

  it('a leaky bucket rejects only when its queue is full', () => {
    const burst = Array.from({ length: 15 }, (_, i) => i);
    const d = limitRequests(burst, 'leaky-bucket', { ...p, burst: 10 });
    // the first is served at once and ten more wait their turn; the rest find the queue full
    expect(d.filter((x) => x.allowed)).toHaveLength(11);
    expect(d.slice(0, 11).every((x) => x.allowed)).toBe(true);
    expect(d.slice(11).some((x) => x.allowed)).toBe(false);
  });

  it('traffic is the same on every run', () => {
    for (const pat of PATTERNS) expect(traffic(pat, 10, 1000, 10_000)).toEqual(traffic(pat, 10, 1000, 10_000));
    expect(traffic('steady', 10, 1000, 10_000)).toHaveLength(150); // one and a half times the limit
  });
});
