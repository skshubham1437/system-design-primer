// Every figure the idempotency, unique ID and observability pages state, recomputed from the models and the
// arithmetic, so a page cannot drift from what it claims. Figures quoted from a source are listed on the page.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { amplification, retryStorm, runPayment } from '../../src/lib/retries';
import { collisionChance, expectedDuplicates, generate, idsForChance, summarizeIds, SETTINGS } from '../../src/lib/unique-id';
import { averageOf, budgetMinutes, budgetSpent, errorRateAt, fanOutSlowShare, hoursToExhaust, seriesCount } from '../../src/lib/slo';

const read = (p: string) => fs.readFileSync(new URL(`../../content/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('the idempotency page', () => {
  const md = read('labs/idempotency.md');
  const p = { clients: 1000, capacity: 100, outage: 10, maxAttempts: 8, baseTicks: 1, capTicks: 32 };

  it('states the storm results the widget shows on its default settings', () => {
    const jitter = retryStorm('full-jitter', p);
    const plain = retryStorm('exponential', p);
    expect(md).toContain('all 1,000 get through, against 400 without jitter, with fewer requests and sooner');
    expect(jitter.succeeded).toBe(1000);
    expect(plain.succeeded).toBe(400);
    expect(jitter.attempts).toBeLessThan(plain.attempts);
    expect(jitter.finishedAt).toBeLessThan(plain.finishedAt);
    expect(md).toContain('With 8 attempts and a 10-second outage, every client uses up its attempts while the server is still down');
    expect(retryStorm('immediate', p).finishedAt).toBeLessThan(p.outage);
    expect(retryStorm('immediate', p).succeeded).toBe(0);
  });

  it('states the multipliers correctly', () => {
    expect(md).toContain('4 attempts at each of 3 layers, which makes 64 attempts');
    expect(amplification(4, 3)).toBe(64);
    expect(md).toContain('3 at each of 5 layers, or 243 times');
    expect(amplification(3, 5)).toBe(243);
  });

  it('says the key column is right when done properly, and describes the broken variants as they behave', () => {
    expect(md).toContain('a crash between the charge and saving the key now charges twice');
    expect(runPayment('crash-after-commit', 'retry-key', 'not-atomic').charges).toBe(2);
    expect(md).toContain('Both turn the key column back into the plain retry column');
    for (const f of ['crash-after-commit', 'reply-lost', 'slow-reply'] as const) for (const m of ['new-key', 'expired'] as const) {
      expect(runPayment(f, 'retry-key', m).charges).toBe(runPayment(f, 'retry').charges);
    }
  });
});

describe('the unique ID page', () => {
  const md = read('labs/unique-ids.md');
  const about = (n: number, digits: number) => Number(n.toPrecision(digits));

  it('states the birthday figures in its table', () => {
    expect(md).toContain('| 32 random bits | about 4.3 billion | about 77,000 |');
    expect(about(idsForChance(2 ** 32), 2)).toBe(77_000);
    expect(about(2 ** 32, 2)).toBe(4.3e9);

    expect(md).toContain('| 7 base 62 characters | about 3.5 trillion | about 2.2 million |');
    expect(about(62 ** 7, 2)).toBe(3.5e12);
    expect(about(idsForChance(62 ** 7), 2)).toBe(2.2e6);

    expect(md).toContain('| 64 random bits | about 18 quintillion | about 5.1 billion |');
    expect(about(2 ** 64, 2)).toBe(1.8e19);
    expect(about(idsForChance(2 ** 64), 2)).toBe(5.1e9);

    expect(md).toContain('| UUIDv4, 122 random bits | about 5.3 × 10^36 | about 2.7 × 10^18 |');
    expect(about(2 ** 122, 2)).toBe(5.3e36);
    expect(about(idsForChance(2 ** 122), 2)).toBe(2.7e18);
  });

  it('states the Pastebin figures and the square-root rule', () => {
    expect(md).toContain('about 18,400 pairs would match');
    expect(about(expectedDuplicates(360e6, 62 ** 7), 3)).toBe(18_400);
    expect(md).toContain('about 1.18 times the square root of d');
    expect(idsForChance(2 ** 40) / Math.sqrt(2 ** 40)).toBeCloseTo(1.18, 2);
    expect(collisionChance(idsForChance(2 ** 40), 2 ** 40)).toBeCloseTo(0.5, 5);
  });

  it('describes the failures as the model produces them', () => {
    expect(md).toContain('its IDs sort before ones issued hundreds of milliseconds earlier');
    expect(summarizeIds('ticket-servers', generate('ticket-servers', 'db-down')).worstGapMs).toBeGreaterThanOrEqual(200);
    expect(md).toContain('collide on every millisecond of the run');
    expect(summarizeIds('snowflake', generate('snowflake', 'shared-worker')).duplicates).toBe(750);
    expect(md).toContain('4,096 IDs per machine per millisecond');
    expect(2 ** 12).toBe(4096);
    expect(md).toContain('The worst gap is the skew');
    expect(summarizeIds('snowflake', generate('snowflake', 'clock-skew')).worstGapMs).toBe(SETTINGS.skewMs);
    expect(md).toContain('up to 1,024 machines');
    expect(2 ** 10).toBe(1024);
    expect(md).toContain('only up to 2^53');
    expect(Number.MAX_SAFE_INTEGER).toBe(2 ** 53 - 1);
  });
});

describe('the observability page', () => {
  const md = read('topics/observability.md');

  it('states the error budgets in its table', () => {
    expect(md).toContain('| 99% | 7.2 hours |');
    expect(budgetMinutes(0.99) / 60).toBeCloseTo(7.2, 6);
    expect(md).toContain('| 99.9% | 43.2 minutes |');
    expect(budgetMinutes(0.999)).toBeCloseTo(43.2, 6);
    expect(md).toContain('| 99.95% | 21.6 minutes |');
    expect(budgetMinutes(0.9995)).toBeCloseTo(21.6, 6);
    expect(md).toContain('| 99.99% | 4.32 minutes |');
    expect(budgetMinutes(0.9999)).toBeCloseTo(4.32, 6);
  });

  it('states the burn rates in its table, which agree with the SRE Workbook', () => {
    expect(md).toContain('| Page | 14.4 | 1 hour | 5 minutes | 2% |');
    expect(budgetSpent(14.4, 1)).toBeCloseTo(0.02, 6);
    expect(md).toContain('| Page | 6 | 6 hours | 30 minutes | 5% |');
    expect(budgetSpent(6, 6)).toBeCloseTo(0.05, 6);
    expect(md).toContain('| Ticket | 1 | 3 days | 6 hours | 10% |');
    expect(budgetSpent(1, 72)).toBeCloseTo(0.1, 6);
    expect(md).toContain('a burn rate of 1 means a 0.1% error rate and a burn rate of 10 means 1%, which uses up the budget in 3 days');
    expect(errorRateAt(1, 0.999)).toBeCloseTo(0.001, 6);
    expect(errorRateAt(10, 0.999)).toBeCloseTo(0.01, 6);
    expect(hoursToExhaust(10) / 24).toBe(3);
  });

  it('states the worked examples correctly', () => {
    expect(md).toContain('That is 10 requests every second, and the rest would be averaging about 50 ms');
    expect(1000 * 0.01).toBe(10);
    expect(averageOf(0.01, 5000, 50.5)).toBeCloseTo(100, 1);
    expect(md).toContain('needs 100 such servers in parallel is slow 63% of the time');
    expect(Math.round(fanOutSlowShare(0.01, 100) * 100)).toBe(63);
    expect(md).toContain('5 methods, 20 routes and 5 status codes make 500 series');
    expect(seriesCount(5, 20, 5)).toBe(500);
    expect(md).toContain('a user ID label with a million users and it is 500 million');
    expect(seriesCount(5, 20, 5, 1e6)).toBe(500e6);
    expect(md).toContain('With 10 requests an hour, one failure is a 10% error rate');
    expect(1 / 10).toBe(0.1);
  });
});
