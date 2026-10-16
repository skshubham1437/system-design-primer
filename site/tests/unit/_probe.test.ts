import fs from 'node:fs';
import path from 'node:path';
import { it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { runAttempt, type Exercise } from '../../src/lib/db/exercise';
import { buffers, rowsRemoved, tempBlocks, worstMisestimate, nodes } from '../../src/lib/db/checks';

const C: { id: string; query: string; ordered?: boolean; setup?: string; fixes: { changes?: string; query?: string; label: string }[] }[] = [
  { id: 'keyset', ordered: true, query: 'select id, created_at, total from orders order by created_at desc offset 50000 limit 20', fixes: [{ label: 'keyset+idx', changes: 'create index on orders (created_at)', query: "select id, created_at, total from orders where created_at < '2023-12-31 14:10:51+00' order by created_at desc limit 20" }, { label: 'keyset no idx', query: "select id, created_at, total from orders where created_at < '2023-12-31 14:10:51+00' order by created_at desc limit 20" }] },
  { id: 'spill-offset', ordered: true, query: 'select order_id, product_id, price from order_items order by price desc, order_id, product_id offset 150000 limit 10', fixes: [{ label: 'work_mem 64', changes: "set local work_mem = '64MB'" }] },
  { id: 'spill-group', ordered: true, query: 'select product_id, count(distinct order_id) as orders from order_items group by product_id order by orders desc, product_id limit 10', fixes: [{ label: 'work_mem 64', changes: "set local work_mem = '64MB'" }] },
];

it('probe', async () => {
  const db = new PGlite();
  await db.exec(fs.readFileSync(path.resolve(__dirname, '../../content/databases/seed.sql'), 'utf8'));
  await db.exec('vacuum analyze');
  const out: string[] = [];
  const kv = (await db.query<{ id: number; created_at: Date }>('select id, created_at from orders order by created_at desc offset 49999 limit 1')).rows[0];
  out.push(`keyset boundary: id ${kv.id} created_at ${kv.created_at.toISOString()}`);
  for (const c of C) {
    const ex = { id: c.id, query: c.query, ordered: c.ordered, setup: c.setup, allowChanges: true, checks: [{ max_cost: 1e12 }] } as unknown as Exercise;
    for (const f of [{ label: 'ORIGINAL' }, ...c.fixes] as { label: string; changes?: string; query?: string }[]) {
      try {
        const t = performance.now();
        const r = await runAttempt(db, ex, { changes: f.changes, query: f.query ?? c.query });
        const ms = Math.round(performance.now() - t);
        const types = [...new Set(nodes(r.plan).map((n) => `${n['Node Type']}${n['Relation Name'] ? ':' + n['Relation Name'] : ''}`))].join(',');
        out.push(`${c.id.padEnd(18)} ${f.label.padEnd(18)} buf ${buffers(r.plan)} removed ${rowsRemoved(r.plan)} temp ${tempBlocks(r.plan)} mis ${worstMisestimate(r.plan).ratio.toFixed(1)} same ${r.sameResult} rows ${r.rows} ${ms}ms | ${types}`);
      } catch (e) { out.push(`${c.id} ${f.label} ERROR ${(e as Error).message}`); }
    }
  }
  fs.writeFileSync(process.env.PROBE_OUT!, out.join('\n'));
  await db.close();
}, 300_000);
