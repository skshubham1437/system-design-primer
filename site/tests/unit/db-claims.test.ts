// The Databases pages make claims about the real outputs printed under their examples ("no Sort node",
// "the estimate is ten times off"). Outputs are produced at build time and can change when the engine or the data
// changes, so these tests re-check every such claim against what was actually printed.
// They read the generated site data, so they run after a content build. Locally they are skipped before one;
// in CI a missing build is a failure, so a reordered workflow cannot quietly skip them.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const file = path.resolve(__dirname, '../../src/generated/site.json');
const built = fs.existsSync(file);
const site = built ? JSON.parse(fs.readFileSync(file, 'utf8')) as { pages: { path: string; html: string }[]; features: Record<string, boolean> } : null;

describe.runIf(!!process.env.CI)('in CI', () => {
  it('the site was built before the tests ran', () => {
    expect(built, 'src/generated/site.json is missing: run npm run build before npm test').toBe(true);
  });
});
const dec = (t: string) => t.replace(/<[^>]+>/g, '').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&#x3C;/g, '<').replace(/&amp;/g, '&');
/** Pages whose outputs some test below checks; the last test makes sure no page with outputs is left out. */
const claimed = new Set<string>();
const pageHtml = (slug: string) => {
  const page = site!.pages.find((p) => p.path === `databases/${slug}/`);
  if (!page) throw new Error(`no page databases/${slug}/`);
  claimed.add(slug);
  return page.html;
};
const outs = (slug: string) => [...pageHtml(slug).matchAll(/<pre class="db-out"[^>]*>([\s\S]*?)<\/pre>/g)].map((m) => dec(m[1]));
const cells = (row: string, tag: string) => [...row.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((c) => dec(c[1]));
/** The result tables of a page's `sql run` blocks, in page order, as rows of column -> printed value. */
const tables = (slug: string) => [...pageHtml(slug).matchAll(/<figure class="db-run" data-kind="run">([\s\S]*?)<\/figure>/g)].map((m) => {
  const head = cells(m[1].match(/<thead>([\s\S]*?)<\/thead>/)?.[1] ?? '', 'th');
  return [...(m[1].match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '').matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
    .map((r) => Object.fromEntries(cells(r[1], 'td').map((v, i) => [head[i], v])));
});
/** "(809,15)" -> [809, 15] */
const ctid = (v: string) => v.slice(1, -1).split(',').map(Number);
const num = (s: string, re: RegExp) => Number((s.match(re) ?? [])[1]);

describe.skipIf(!built || !site?.features.advancedDb)('claims the Databases pages make about their outputs', () => {
  it('B-tree indexes', () => {
    const o = outs('btree-indexes');
    expect(o[0]).toMatch(/Seq Scan on orders/);
    expect(o[0]).toMatch(/Rows Removed by Filter: 99956/);
    expect(num(o[1], /Buffers: shared hit=(\d+)/)).toBeLessThan(100);  // "drops by more than an order of magnitude"
    expect(o[2]).not.toMatch(/Sort/);                                   // "No Sort node"
    expect(o[2]).toMatch(/Index Scan using orders_user_id_idx/);
  });

  it('scan types', () => {
    const o = outs('scan-types');
    expect(o[0]).toMatch(/^Index Scan using orders_created_at_idx/);
    expect(num(o[1], /exact=(\d+)/)).toBeGreaterThan(800);              // "almost every page of the table"
    expect(o[2]).toMatch(/Index Only Scan/);
    expect(o[3]).toMatch(/Seq Scan/);
  });

  it('designing indexes', () => {
    const o = outs('index-design');
    expect(num(o[1], /Index Searches: (\d+)/)).toBeGreaterThan(1);      // skip scan
    expect(o[2]).toMatch(/Heap Fetches: 0/);
    expect(o[3]).not.toMatch(/Sort/);
    expect(o[5]).toMatch(/Bitmap/);                                     // rare value uses the index
    expect(o[6]).toMatch(/Seq Scan/);                                   // common value does not
  });

  it('reading plans', () => {
    const o = outs('reading-plans');
    expect(o[1]).toMatch(/Seq Scan on orders/);
    const scan = o[2].split('\n').find((l) => l.includes('Seq Scan on orders'))!;
    expect(num(scan, /rows=(\d+) width/) / num(scan, /actual time=[\d.]+\.\.[\d.]+ rows=(\d+)/)).toBeGreaterThan(10); // a bad estimate
    expect(o[4]).toMatch(/external merge/);
  });

  it('joins', () => {
    const o = outs('joins');
    expect(o[0]).toMatch(/^Nested Loop/);
    expect(o[1]).toMatch(/Hash Join/);
    expect(o[1]).toMatch(/Batches: 1/);
    expect(o[2]).toMatch(/Merge Join/);
    expect(o[2]).not.toMatch(/->\s+Sort/);                               // both inputs already in order
    expect(o[3]).toMatch(/^Nested Loop/);
    expect(o[4]).toMatch(/^Hash Join/);
    expect(num(o[4], /Buffers: shared hit=(\d+)/)).toBeGreaterThan(num(o[3], /Buffers: shared hit=(\d+)/)); // "read far more"
  });

  it('planner statistics', () => {
    const o = outs('statistics');
    expect(o[2]).toMatch(/rows=200 /);                                   // a tenth of the real count
    expect(o[2]).toMatch(/rows=2000\.00/);
    expect(o[3]).toMatch(/rows=2000 /);                                  // fixed by CREATE STATISTICS
  });

  it('pagination and N+1', () => {
    const o = outs('pagination-and-n-plus-one');
    expect(o[0]).toMatch(/rows=50020/);
    expect(num(o[1], /Buffers: shared hit=(\d+)/)).toBeLessThan(10);
    expect(o[3]).toMatch(/Index Searches: 5/);
  });

  it('CTEs, window functions and views', () => {
    const c = outs('ctes');
    expect(c[0]).not.toMatch(/CTE Scan/);
    expect(c[1]).toMatch(/CTE Scan/);
    expect(outs('window-functions')[0]).toMatch(/WindowAgg[\s\S]*Sort/);
    expect(outs('views-functions-triggers')[0]).toMatch(/orders_pkey[\s\S]*users_pkey/); // the view is merged away
  });

  it('partitioning', () => {
    const o = outs('partitioning');
    expect(o[0].match(/Seq Scan on events_2024_/g)).toHaveLength(1);    // pruned to one partition
    expect(o[1].match(/Seq Scan on events_2024_/g)).toHaveLength(12);   // a function of the key: all twelve
    expect(o[2].match(/Seq Scan on sessions_/g)).toHaveLength(1);
  });

  it('how a table is stored', () => {
    const [sizes, first, [before], [after]] = tables('how-rows-are-stored');
    const orders = sizes.find((r) => r.table_name === 'orders')!;
    const pages = Number(orders.pages);
    expect(Number(orders.estimated_rows)).toBe(100000);                 // "the 100,000 orders"
    expect(pages).toBeGreaterThan(800);                                  // "a little over 800 pages"
    expect(pages).toBeLessThan(850);
    expect(Math.round(100000 / pages / 10) * 10).toBe(120);              // "roughly 120 rows per page"
    first.forEach((r, i) => expect(ctid(r.ctid)).toEqual([0, i + 1]));   // consecutive ids side by side on page 0
    expect(ctid(before.ctid)[0]).toBe(0);
    expect(after.ctid).not.toBe(before.ctid);                            // "the row has a new ctid"
    expect(ctid(after.ctid)[0]).toBe(pages - 1);                         // "went to the end of the table"
    expect(Number(after.xmin)).toBeGreaterThan(Number(before.xmin));     // "written by a newer transaction"
    expect(after.status).toBe('shipped');
  });

  it('transactions', () => {
    const [changed, restored] = tables('transactions');
    expect(changed[0].status).toBe('cancelled');
    expect(restored[0].status).not.toBe('cancelled');                    // "back to its original status"
  });

  it('locks', () => {
    const [held] = tables('locks-and-deadlocks');
    const mode = (rel: string) => held.find((r) => r.relation === rel)?.mode;
    expect(mode('orders')).toBe('RowExclusiveLock');                     // the update
    expect(mode('orders_pkey')).toBe('RowExclusiveLock');                // "and its indexes"
    expect(mode('products')).toBe('ShareLock');                          // the index build: reads yes, writes no
    expect(held.find((r) => r.locktype === 'transactionid')?.mode).toBe('ExclusiveLock');
    expect(held.every((r) => r.granted === 'true')).toBe(true);
  });

  it('the playground', () => {
    const [counts] = tables('playground');
    const n = (t: string) => Number(counts.find((r) => r.table_name === t)!.rows);
    // the playground's "Ready" message states these counts by hand (src/scripts/features/sql-playground.ts)
    const ready = fs.readFileSync(path.resolve(__dirname, '../../src/scripts/features/sql-playground.ts'), 'utf8');
    for (const t of ['users', 'products', 'orders']) expect(ready).toContain(`${n(t).toLocaleString('en-US')} ${t}`);
  });

  it('every page that shows real outputs has its claims checked above', () => {
    const withOutputs = site!.pages.filter((p) => p.path.startsWith('databases/') && /<figure class="db-run"/.test(p.html)).map((p) => p.path.split('/')[1]);
    expect(withOutputs.length).toBeGreaterThan(10);
    expect(withOutputs.filter((slug) => !claimed.has(slug)), 'add a test for these pages: what does their prose say about their outputs?').toEqual([]);
  });
});

describe.skipIf(!built || !site?.features.advancedDb)('Databases study material in the build', () => {
  it('the flashcard deck includes the Databases cards, each front once', () => {
    const cards = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../src/generated/flashcards.json'), 'utf8')) as { key: string; front: string; back: string; draft?: boolean }[];
    const fronts = cards.map((c) => c.front);
    expect(fronts).toContain('What is SKIP LOCKED for?');
    expect(new Set(fronts).size).toBe(fronts.length);
    const skip = cards.find((c) => c.front === 'What is SKIP LOCKED for?')!;
    expect(skip.back).toContain('databases/locks-and-deadlocks/');
    // progress is stored under the key: a stable id for the site's own cards, so rewording a front keeps it
    expect(skip.key).toBe('db-skip-locked');
    expect(new Set(cards.map((c) => c.key)).size).toBe(cards.length);
  });
  it('every Databases topic with a quiz has it attached', () => {
    const quizzes = (JSON.parse(fs.readFileSync(file, 'utf8')) as { quizzes: { topic: string }[] }).quizzes.map((q) => q.topic);
    for (const t of ['btree-indexes', 'index-design', 'reading-plans', 'joins', 'isolation-and-mvcc', 'locks-and-deadlocks', 'partitioning']) expect(quizzes).toContain(`databases/${t}/`);
  });
});
