// The Databases section on the real engine: the sample data, every exercise, and the build-time runner.
// One PGlite instance is shared by the whole file; each exercise attempt runs in a transaction that is rolled back.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { load as loadYaml } from 'js-yaml';
import { runAttempt, type Exercise } from '../../src/lib/db/exercise';
import { evaluate, rowsRemoved, buffers, type PlanNode } from '../../src/lib/db/checks';
import { parseRunMeta, outputHtml } from '../../scripts/lib/db-runs.mjs';

const SITE = path.resolve(__dirname, '../..');
const seed = fs.readFileSync(path.join(SITE, 'content/databases/seed.sql'), 'utf8');
const exercises: Exercise[] = fs.readdirSync(path.join(SITE, 'content/databases/exercises'))
  .filter((f) => f.endsWith('.yaml'))
  .map((f) => loadYaml(fs.readFileSync(path.join(SITE, 'content/databases/exercises', f), 'utf8')) as Exercise);

let db: PGlite;
beforeAll(async () => { db = new PGlite(); await db.exec(seed); }, 120_000);
afterAll(async () => { await db?.close(); });

describe('the sample database', () => {
  it('has the documented size and shape', async () => {
    const r = (await db.query<Record<string, number>>(`select
      (select count(*)::int from users) users, (select count(*)::int from products) products,
      (select count(*)::int from orders) orders, (select count(*)::int from order_items) items,
      (select count(*)::int from events) events,
      (select count(*)::int from orders where status = 'pending') pending,
      (select count(*)::int from orders where user_id = 1) user1`)).rows[0];
    expect(r).toMatchObject({ users: 20000, products: 2000, orders: 100000, events: 60000 });
    expect(r.items).toBeGreaterThan(290000);
    expect(r.pending / r.orders).toBeGreaterThan(0.03);
    expect(r.pending / r.orders).toBeLessThan(0.05);
    expect(r.user1).toBeGreaterThan(300); // the skew the pages talk about
  });

  it('has no secondary indexes: finding the right ones is the point of the exercises', async () => {
    const r = await db.query<{ indexname: string }>(`select indexname from pg_indexes where schemaname = 'public' and indexname not like '%_pkey' and indexname not like '%_key' and tablename not like 'events%'`);
    expect(r.rows).toEqual([]);
  });

  it('gives exact, repeatable estimates (ANALYZE reads every row)', async () => {
    const est = async (q: string) => (await db.query<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(`explain (format json) ${q}`)).rows[0]['QUERY PLAN'][0].Plan['Plan Rows'];
    expect(await est('select * from orders where user_id = 42')).toBe(44);
    expect(await est("select * from orders where status = 'pending'")).toBe(4005);
  });

  it('keeps dates in UTC and inside the event partitions', async () => {
    const r = (await db.query<{ tz: string; outside: number }>(`select current_setting('TimeZone') tz, (select count(*)::int from events where at < '2024-01-01' or at >= '2025-01-01') outside`)).rows[0];
    expect(r).toEqual({ tz: 'UTC', outside: 0 });
  });
});

describe('query-tuning exercises', () => {
  it('there are some', () => expect(exercises.length).toBeGreaterThanOrEqual(2));

  for (const ex of exercises) {
    describe(ex.id, () => {
      it('the original query fails its checks but returns the reference rows', async () => {
        const r = await runAttempt(db, ex, { query: ex.query });
        expect(r.sameResult).toBe(true);
        expect(r.passed, `"${ex.id}" passes without any change, so it teaches nothing`).toBe(false);
      });

      it('the stated solution passes every check', async () => {
        const r = await runAttempt(db, ex, { changes: ex.solution.changes, query: ex.solution.query ?? ex.query });
        const failed = r.checks.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}`);
        expect(failed, r.planText.join('\n')).toEqual([]);
      });

      it('an attempt that changes the answer is caught, even if it is fast', async () => {
        const wrong = ex.query.replace(/where[\s\S]*?(order by|group by|limit|$)/i, '$1');
        const r = await runAttempt(db, ex, { changes: ex.solution.changes, query: wrong });
        expect(r.sameResult).toBe(false);
        expect(r.passed).toBe(false);
      });

      it('leaves the database exactly as it was', async () => {
        await runAttempt(db, ex, { changes: ex.solution.changes, query: ex.solution.query ?? ex.query });
        const r = await db.query(`select indexname from pg_indexes where schemaname = 'public' and indexname not like '%_pkey' and indexname not like '%_key' and tablename not like 'events%'`);
        expect(r.rows).toEqual([]);
      });
    });
  }
});

describe('plan checks', () => {
  const plan: PlanNode = {
    'Node Type': 'Sort', 'Total Cost': 2061, 'Shared Hit Blocks': 810, 'Shared Read Blocks': 0,
    Plans: [{ 'Node Type': 'Seq Scan', 'Relation Name': 'orders', 'Rows Removed by Filter': 99956, 'Actual Loops': 1 }],
  };
  it('find, count and judge what the plan did', () => {
    expect(rowsRemoved(plan)).toBe(99956);
    expect(buffers(plan)).toBe(810);
    const r = evaluate(plan, [{ avoid: { node: 'Seq Scan', relation: 'orders' } }, { uses: { node: ['Index Scan', 'Bitmap Heap Scan'] } }, { max_buffers: 1000 }, { max_cost: 100 }]);
    expect(r.map((x) => x.ok)).toEqual([false, false, true, false]);
  });
  it('multiplies per-loop filter counts by the number of loops', () => {
    expect(rowsRemoved({ 'Node Type': 'Nested Loop', Plans: [{ 'Node Type': 'Index Scan', 'Rows Removed by Filter': 3, 'Actual Loops': 10 }] })).toBe(30);
  });
});

describe('build-time SQL blocks', () => {
  it('recognise the kinds of runnable block', () => {
    expect(parseRunMeta('sql', 'explain-analyze')).toEqual({ kind: 'explain-analyze', hidden: false });
    expect(parseRunMeta('sql', 'setup hidden')).toEqual({ kind: 'setup', hidden: true });
    expect(parseRunMeta('sql', null)).toBeNull();
    expect(parseRunMeta('python', 'run')).toBeNull();
  });
  it('render outputs safely, and say they are real', () => {
    const html = outputHtml({ kind: 'run', columns: ['a<b'], rows: [['<script>']], total: 1 }, 'PostgreSQL 18.6 (PGlite 0.5.9)');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('real output from PostgreSQL 18.6');
    expect(outputHtml({ kind: 'setup' }, 'x')).toBe('');
  });
});
