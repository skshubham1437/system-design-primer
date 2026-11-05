import { describe, expect, it } from 'vitest';
import { BACKOFFS, FAULTS, MISTAKES, POLICIES, amplification, backoffCeiling, grade, retryStorm, runPayment, type Backoff, type Fault } from '../../src/lib/retries';

const DUPLICATING: Fault[] = ['crash-after-commit', 'reply-lost', 'slow-reply'];
const NO_EFFECT: Fault[] = ['request-lost', 'crash-before-commit'];

describe('one payment under failure', () => {
  it('with nothing failing, every policy charges once', () => {
    for (const p of POLICIES) expect(grade(runPayment('none', p))).toBe('right');
  });

  it('a client that does not retry never knows the result, whichever way it went', () => {
    for (const f of NO_EFFECT) expect(runPayment(f, 'no-retry')).toMatchObject({ charges: 0, client: 'unknown' });
    for (const f of DUPLICATING) expect(runPayment(f, 'no-retry')).toMatchObject({ charges: 1, client: 'unknown' });
  });

  it('every fault looks the same to the client: a timeout with no reply', () => {
    for (const f of FAULTS.filter((x) => x !== 'none')) {
      const seen = runPayment(f, 'no-retry').steps.filter((s) => s.who === 'client').map((s) => s.text);
      expect(seen, f).toEqual(runPayment('request-lost', 'no-retry').steps.filter((s) => s.who === 'client').map((s) => s.text));
    }
  });

  it('a plain retry charges once or twice depending on something the client cannot see', () => {
    for (const f of NO_EFFECT) expect(runPayment(f, 'retry').charges, f).toBe(1);
    for (const f of DUPLICATING) expect(runPayment(f, 'retry').charges, f).toBe(2);
  });

  it('a retry with an idempotency key charges exactly once under every fault, and the client knows', () => {
    for (const f of FAULTS) expect(grade(runPayment(f, 'retry-key')), f).toBe('right');
  });

  it('a retry that finds the key replays the saved response instead of charging', () => {
    const steps = runPayment('reply-lost', 'retry-key').steps;
    expect(steps.some((s) => s.text.includes('return the saved response'))).toBe(true);
    expect(steps.at(-1)!.charges).toBe(1);
  });

  it('a retry during the first attempt is told to wait, then gets the saved response', () => {
    const o = runPayment('slow-reply', 'retry-key');
    expect(o.attempts).toBe(3);
    expect(o.steps.some((s) => s.text.includes('409 Conflict'))).toBe(true);
    expect(o.charges).toBe(1);
  });

  it('a new key on each retry is the same as no key', () => {
    for (const f of FAULTS) expect(runPayment(f, 'retry-key', 'new-key').charges, f).toBe(runPayment(f, 'retry').charges);
  });

  it('a key saved separately from the charge fails only where the gap between them shows', () => {
    expect(runPayment('crash-after-commit', 'retry-key', 'not-atomic').charges).toBe(2); // crashed in the gap
    expect(runPayment('slow-reply', 'retry-key', 'not-atomic').charges).toBe(2); // the retry arrived in the gap
    expect(runPayment('reply-lost', 'retry-key', 'not-atomic').charges).toBe(1); // the key was saved before the reply was lost
  });

  it('a retry after the key has been deleted is a new request', () => {
    for (const f of DUPLICATING) expect(runPayment(f, 'retry-key', 'expired').charges, f).toBe(2);
    for (const f of NO_EFFECT) expect(runPayment(f, 'retry-key', 'expired').charges, f).toBe(1);
  });

  it('mistakes only change the key policy', () => {
    for (const m of MISTAKES) for (const f of FAULTS) {
      expect(runPayment(f, 'retry', m).charges).toBe(runPayment(f, 'retry').charges);
      expect(runPayment(f, 'no-retry', m).charges).toBe(runPayment(f, 'no-retry').charges);
    }
  });

  it('the running charge count in the steps ends at the final count', () => {
    for (const f of FAULTS) for (const p of POLICIES) for (const m of MISTAKES) {
      const o = runPayment(f, p, m);
      expect(o.steps.at(-1)!.charges, `${f} ${p} ${m}`).toBe(o.charges);
    }
  });
});

describe('many clients retrying', () => {
  const p = { clients: 1000, capacity: 100, outage: 10, maxAttempts: 8, baseTicks: 1, capTicks: 32 };
  const run = (b: Backoff, over = {}) => retryStorm(b, { ...p, ...over });

  it('accounts for every client', () => {
    for (const b of BACKOFFS) for (const outage of [5, 10, 30]) for (const maxAttempts of [2, 5, 8]) {
      const r = run(b, { outage, maxAttempts });
      expect(r.succeeded + r.gaveUp, `${b} ${outage} ${maxAttempts}`).toBe(p.clients);
      expect(r.attempts, b).toBe(r.offered.reduce((a, n) => a + n, 0));
      expect(r.succeeded, b).toBe(r.served.reduce((a, n) => a + n, 0));
    }
  });

  it('never answers during the outage or above capacity', () => {
    for (const b of BACKOFFS) {
      const r = run(b);
      r.served.forEach((n, t) => expect(n).toBeLessThanOrEqual(t < p.outage ? 0 : p.capacity));
    }
  });

  it('without retries, nobody gets through', () => {
    expect(run('no-retry')).toMatchObject({ succeeded: 0, gaveUp: 1000, attempts: 1000 });
  });

  it('immediate retries spend every attempt during the outage', () => {
    expect(run('immediate')).toMatchObject({ succeeded: 0, gaveUp: 1000, attempts: 8000, finishedAt: 7 });
  });

  it('exponential backoff without jitter retries in waves, wasting the capacity between them', () => {
    const r = run('exponential');
    expect(r.offered.map((n, t) => (n ? t : -1)).filter((t) => t >= 0)).toEqual([0, 1, 3, 7, 15, 31, 63, 95]); // 1, 2, 4, 8, 16, 32, 32
    expect(r.peakAfter).toBe(1000);
    expect(r).toMatchObject({ succeeded: 400, gaveUp: 600 });
  });

  it('full jitter gets everyone through with fewer attempts, sooner, on the same retry allowance', () => {
    const j = run('full-jitter');
    const e = run('exponential');
    expect(j.succeeded).toBe(1000);
    expect(j.attempts).toBeLessThan(e.attempts);
    expect(j.finishedAt).toBeLessThan(e.finishedAt);
    expect(j.peakAfter).toBeLessThan(e.peakAfter / 3);
  });

  it('full jitter does better than plain backoff for any seed and a range of settings', () => {
    for (const seed of [1, 2, 3, 4, 5]) for (const capacity of [50, 100, 200]) {
      expect(run('full-jitter', { seed, capacity }).succeeded, `${seed} ${capacity}`).toBeGreaterThan(run('exponential', { capacity }).succeeded);
    }
  });

  it('is the same on every run', () => {
    expect(run('full-jitter')).toEqual(run('full-jitter'));
  });

  it('caps the wait', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((r) => backoffCeiling(r, 1, 32))).toEqual([1, 2, 4, 8, 16, 32, 32]);
  });

  it('retrying at every layer multiplies, as in both sources', () => {
    expect(amplification(4, 3)).toBe(64); // Google SRE book
    expect(amplification(3, 5)).toBe(243); // Amazon Builders' Library
  });
});
