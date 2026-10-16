// The Databases pages make claims about the real outputs printed under their examples ("no Sort node",
// "the estimate is ten times off"). Outputs are produced at build time and can change when the engine or the data
// changes, so these tests re-check every such claim against what was actually printed.
// They read the generated site data, so they run after a content build and are skipped before one.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const file = path.resolve(__dirname, '../../src/generated/site.json');
const built = fs.existsSync(file);
const site = built ? JSON.parse(fs.readFileSync(file, 'utf8')) as { pages: { path: string; html: string }[]; features: Record<string, boolean> } : null;
const dec = (t: string) => t.replace(/<[^>]+>/g, '').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&#x3C;/g, '<').replace(/&amp;/g, '&');
const outs = (slug: string) => {
  const page = site!.pages.find((p) => p.path === `databases/${slug}/`);
  if (!page) throw new Error(`no page databases/${slug}/`);
  return [...page.html.matchAll(/<pre class="db-out"[^>]*>([\s\S]*?)<\/pre>/g)].map((m) => dec(m[1]));
};
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

  it('locks', () => {
    const page = site!.pages.find((p) => p.path === 'databases/locks-and-deadlocks/')!;
    expect(dec(page.html)).toMatch(/products\s*ShareLock/);
  });
});

describe.skipIf(!built || !site?.features.advancedDb)('Databases study material in the build', () => {
  it('the flashcard deck includes the Databases cards, each front once', () => {
    const cards = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../src/generated/flashcards.json'), 'utf8')) as { front: string; back: string }[];
    const fronts = cards.map((c) => c.front);
    expect(fronts).toContain('What is SKIP LOCKED for?');
    expect(new Set(fronts).size).toBe(fronts.length);
    expect(cards.find((c) => c.front === 'What is SKIP LOCKED for?')!.back).toContain('databases/locks-and-deadlocks/');
  });
  it('every Databases topic with a quiz has it attached', () => {
    const quizzes = (JSON.parse(fs.readFileSync(file, 'utf8')) as { quizzes: { topic: string }[] }).quizzes.map((q) => q.topic);
    for (const t of ['btree-indexes', 'index-design', 'reading-plans', 'joins', 'isolation-and-mvcc', 'locks-and-deadlocks', 'partitioning']) expect(quizzes).toContain(`databases/${t}/`);
  });
});
