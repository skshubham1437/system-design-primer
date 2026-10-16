import { describe, expect, it } from 'vitest';
import { build, emptyTree, height, insert, leafChain, layout, problems, range, search } from '../../src/lib/db/btree';
import { makeTable, scanSteps, finalCounts, PAGES, PER_PAGE, indexOrder } from '../../src/lib/db/scans';
import { makeEntries, QUERIES, usage } from '../../src/lib/db/composite';
import { planSteps, hottest } from '../../src/lib/db/plan-steps';
import type { PlanNode } from '../../src/lib/db/checks';
import { mulberry32 } from '../../src/lib/sim';

describe('B+tree', () => {
  const shuffled = (n: number, seed: number) => { const r = mulberry32(seed); const a = Array.from({ length: n }, (_, i) => i + 1); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  it('stays a valid, balanced B+tree whatever the insert order', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const t = build(shuffled(60, seed));
      expect(problems(t)).toEqual([]);
      expect(leafChain(t).flatMap((n) => n.keys)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    }
    expect(problems(build(Array.from({ length: 40 }, (_, i) => i + 1)))).toEqual([]); // ascending inserts, the worst case for splits
  });

  it('grows in height only by splitting the root, slowly', () => {
    expect(height(emptyTree())).toBe(1);
    expect(height(build([1, 2, 3]))).toBe(1);
    expect(height(build([1, 2, 3, 4]))).toBe(2);
    expect(height(build(shuffled(60, 9)))).toBeLessThanOrEqual(5);
  });

  it('reports each split, including the new root, and earlier frames are not changed by later ones', () => {
    const { steps } = insert(build([1, 2, 3]), 4);
    expect(steps.some((s) => /new root/.test(s.note))).toBe(true);
    const sizes = steps.map((s) => Object.keys(s.tree.nodes).length);
    expect(sizes[0]).toBe(1);
    expect(sizes[sizes.length - 1]).toBe(3);
  });

  it('search reads one page per level, hit or miss', () => {
    const t = build(shuffled(40, 3));
    const hit = search(t, 17), miss = search(t, 99);
    expect(hit.at(-1)!.hit).toEqual([17]);
    expect(miss.at(-1)!.hit).toEqual([]);
    expect(hit.length).toBe(height(t) + 1);
    expect(miss.length).toBe(height(t) + 1);
  });

  it('a range scan returns every key in order by following leaf links', () => {
    const t = build(shuffled(40, 7));
    expect(range(t, 11, 23).at(-1)!.hit).toEqual(Array.from({ length: 13 }, (_, i) => i + 11));
    expect(range(t, 41, 50).at(-1)!.hit).toEqual([]);
  });

  it('lays out without overlapping nodes on a level', () => {
    const { nodes } = layout(build(shuffled(30, 2)));
    const byLevel = new Map<number, typeof nodes>();
    for (const n of nodes) byLevel.set(n.y, [...(byLevel.get(n.y) ?? []), n]);
    for (const level of byLevel.values()) {
      const sorted = [...level].sort((a, b) => a.x - b.x);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i].x).toBeGreaterThanOrEqual(sorted[i - 1].x + sorted[i - 1].w);
    }
  });
});

describe('scan types', () => {
  const table = makeTable();
  it('a sequential scan reads every page once and tests every row', () => {
    const c = finalCounts(scanSteps(table, 'seq', 10, 12));
    expect(c.pageReads).toBe(PAGES);
    expect(c.rowsExamined).toBe(PAGES * PER_PAGE);
  });
  it('all three return the same rows', () => {
    const want = indexOrder(table, 10, 14).length;
    for (const k of ['seq', 'index', 'bitmap'] as const) expect(finalCounts(scanSteps(table, k, 10, 14)).returned).toBe(want);
  });
  it('for a narrow range the index reads far fewer pages; a bitmap scan reads each page once', () => {
    const idx = finalCounts(scanSteps(table, 'index', 10, 12));
    const bmp = finalCounts(scanSteps(table, 'bitmap', 10, 12));
    expect(idx.pageReads).toBeLessThan(PAGES);
    expect(bmp.pageReads).toBe(bmp.distinctPages);
    expect(bmp.pageReads).toBeLessThanOrEqual(idx.pageReads);
  });
  it('for a wide range an index scan visits more pages than the table has', () => {
    expect(finalCounts(scanSteps(table, 'index', 1, 40)).pageReads).toBeGreaterThan(PAGES);
  });
});

describe('composite index usage', () => {
  const entries = makeEntries();
  const u = (id: string) => usage(entries, QUERIES.find((q) => q.id === id)!);
  it('the leading column gives one contiguous slice', () => { expect(u('lead').ranges).toHaveLength(1); expect(u('both').ranges).toHaveLength(1); });
  it('an IN list gives one slice per value', () => expect(u('in').ranges).toHaveLength(2));
  it('only the second column scatters the matches: a skip scan, one search per leading value', () => {
    expect(u('second').kind).toBe('skip');
    expect(u('second').ranges.length).toBe(4);
  });
  it('entries are sorted by country, then status', () => {
    const keys = entries.map((e) => `${e.country}/${e.status}`);
    expect([...keys].sort()).toEqual(keys);
  });
});

describe('plan stepper', () => {
  const plan: PlanNode = {
    'Node Type': 'Sort', 'Plan Rows': 47, 'Actual Rows': 44, 'Actual Loops': 1, 'Actual Total Time': 14.4, 'Sort Method': 'quicksort',
    Plans: [{ 'Node Type': 'Seq Scan', 'Relation Name': 'orders', 'Plan Rows': 47, 'Actual Rows': 44, 'Actual Loops': 1, 'Actual Total Time': 14.1, 'Rows Removed by Filter': 99956 }],
  };
  it('lists children before parents', () => expect(planSteps(plan).map((s) => s.node['Node Type'])).toEqual(['Seq Scan', 'Sort']));
  it('separates a node\'s own time from its children\'s', () => {
    const [scan, sort] = planSteps(plan);
    expect(scan.selfMs).toBeCloseTo(14.1);
    expect(sort.selfMs).toBeCloseTo(0.3);
    expect(hottest(planSteps(plan)).label).toBe('Seq Scan on orders');
  });
  it('flags a scan that throws most rows away, a bad estimate and a spill', () => {
    expect(planSteps(plan)[0].flags.join()).toMatch(/index/);
    const bad = planSteps({ 'Node Type': 'Seq Scan', 'Plan Rows': 5, 'Actual Rows': 5000, 'Actual Loops': 1 })[0];
    expect(bad.misestimate).toBe(1000);
    expect(bad.flags.join()).toMatch(/expected 5 rows/);
    expect(planSteps({ 'Node Type': 'Sort', 'Sort Method': 'external merge', 'Plan Rows': 1, 'Actual Rows': 1 })[0].flags.join()).toMatch(/spilled/);
  });
});

describe('plan stepper on joins', () => {
  it('runs the build side of a hash join before the probe side, and names aggregates as the text plan does', () => {
    const plan: PlanNode = {
      'Node Type': 'Aggregate', Strategy: 'Hashed', 'Plan Rows': 8, 'Actual Rows': 8,
      Plans: [{ 'Node Type': 'Hash Join', 'Plan Rows': 10, 'Actual Rows': 10, Plans: [
        { 'Node Type': 'Seq Scan', 'Relation Name': 'orders', 'Plan Rows': 10, 'Actual Rows': 10 },
        { 'Node Type': 'Hash', 'Plan Rows': 5, 'Actual Rows': 5, Plans: [{ 'Node Type': 'Seq Scan', 'Relation Name': 'users', 'Plan Rows': 5, 'Actual Rows': 5 }] },
      ] }],
    };
    expect(planSteps(plan).map((s) => s.label)).toEqual(['Seq Scan on users', 'Hash', 'Seq Scan on orders', 'Hash Join', 'HashAggregate']);
  });
});
