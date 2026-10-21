// Records the "at production scale" runs in content/databases/scale-runs.yaml: the same queries as some pages, on
// the sample shop at 100 times the size (content/databases/seed-scale.sql), on a real PostgreSQL server.
// Writes one recording per scenario to data/db-scale/<id>.json. Nothing on the pages about these runs is typed by hand.
//
//   node scripts/record-scale.mjs            start a throwaway container (postgres:18), load, record, remove it
//   node scripts/record-scale.mjs <id>       record one scenario
//   PGURL=postgres://... node scripts/...    use a server you already run (it must not hold anything you need:
//                                            the users and orders tables are dropped and re-created)
//
// Loading ten million orders takes a few minutes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(here, '..');
const OUT = path.join(SITE, 'data', 'db-scale');
const seed = fs.readFileSync(path.join(SITE, 'content', 'databases', 'seed-scale.sql'), 'utf8');
const scenarios = loadYaml(fs.readFileSync(path.join(SITE, 'content', 'databases', 'scale-runs.yaml'), 'utf8'));
const only = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

let container = null;
let url = process.env.PGURL;
if (!url) {
  const image = process.env.PGIMAGE || 'postgres:18';
  container = `primer-scale-${process.pid}`;
  // throwaway local container; enough shared memory for parallel queries, and a buffer cache that holds the tables
  execFileSync('docker', ['run', '-d', '--rm', '--name', container, '--shm-size=1g', '-e', 'POSTGRES_PASSWORD=scale', '-p', '127.0.0.1:55433:5432', image, '-c', 'shared_buffers=1GB'], { stdio: 'ignore' });
  url = 'postgres://postgres:scale@127.0.0.1:55433/postgres';
  for (let i = 0; i < 60; i++) {
    try { const c = new pg.Client({ connectionString: url }); await c.connect(); await c.query('select 1'); await c.end(); break; } catch { await sleep(500); }
  }
}

const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  const version = (await db.query('select version() as v')).rows[0].v.split(' on ')[0];
  const t0 = Date.now();
  console.log(`${version}: loading the 100x seed…`);
  await db.query('drop table if exists orders, users cascade');
  await db.query(seed);
  await db.query('vacuum analyze');
  const sizes = (await db.query('select (select count(*) from users)::int as users, (select count(*) from orders)::int as orders')).rows[0];
  console.log(`loaded ${sizes.users.toLocaleString('en-US')} users and ${sizes.orders.toLocaleString('en-US')} orders in ${Math.round((Date.now() - t0) / 1000)} s`);
  fs.mkdirSync(OUT, { recursive: true });

  for (const sc of scenarios) {
    if (only && sc.id !== only) continue;
    const binds = {};
    const fill = (sql) => sql.replace(/:([a-z_]+)\b/g, (m, name) => (name in binds ? `'${binds[name].replace(/'/g, "''")}'` : m));
    const steps = [];
    await db.query('begin');
    try {
      for (const st of sc.steps) {
        const sql = fill(st.sql.trim());
        if (st.kind === 'setup') { await db.query(sql); steps.push({ kind: 'setup', sql }); continue; }
        if (st.kind === 'bind') { binds[st.name] = Object.values((await db.query(sql)).rows[0])[0]; continue; }
        const explain = `explain (analyze, buffers) ${sql.replace(/;\s*$/, '')}`;
        await db.query(explain); // first run warms the cache; the second is the one kept
        const text = (await db.query(explain)).rows.map((r) => r['QUERY PLAN']).join('\n');
        steps.push({ kind: 'explain-analyze', label: st.label, sql, text });
        console.log(`  ${sc.id} / ${st.label}: ${text.match(/Execution Time: ([\d.]+ ms)/)?.[1]}`);
      }
    } finally {
      await db.query('rollback');
    }
    const rec = { id: sc.id, scenario: hash(JSON.stringify(sc)), seed: hash(seed), engine: version, recorded: new Date().toISOString().slice(0, 10), sizes, title: sc.title, steps };
    fs.writeFileSync(path.join(OUT, `${sc.id}.json`), JSON.stringify(rec, null, 1) + '\n');
  }
} finally {
  await db.end();
  if (container) execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
}
