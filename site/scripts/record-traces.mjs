// Records the concurrency scenarios in content/databases/concurrency-scenarios.yaml against a real PostgreSQL
// server with several connections, and writes one trace per scenario to data/db-traces/<id>.json.
// The pages replay these traces; nothing about locking or isolation on them is typed by hand.
//
//   node scripts/record-traces.mjs            start a throwaway container (postgres:18), record, remove it
//   PGURL=postgres://... node scripts/...     record against a server you already run
//
// It refuses to write a trace when a step does not do what the scenario says it should (ok, waits or error).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(here, '..');
const OUT = path.join(SITE, 'data', 'db-traces');
const scenarios = loadYaml(fs.readFileSync(path.join(SITE, 'content', 'databases', 'concurrency-scenarios.yaml'), 'utf8'));
const only = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WAIT_MS = 400;       // a statement still running after this long is waiting for a lock
const DEADLOCK_MS = 1600;  // deadlock_timeout is 1 s by default; give detection time to happen

let container = null;
let url = process.env.PGURL;
if (!url) {
  const image = process.env.PGIMAGE || 'postgres:18';
  container = `primer-traces-${process.pid}`;
  // throwaway local container; the password only exists for the few seconds this runs
  execFileSync('docker', ['run', '-d', '--rm', '--name', container, '-e', 'POSTGRES_PASSWORD=traces', '-p', '127.0.0.1:55432:5432', image], { stdio: 'ignore' });
  url = 'postgres://postgres:traces@127.0.0.1:55432/postgres';
  for (let i = 0; i < 60; i++) {
    try { const c = new pg.Client({ connectionString: url }); await c.connect(); await c.query('select 1'); await c.end(); break; } catch { await sleep(500); }
  }
}

const shortRows = (r) => (r?.rows ?? []).slice(0, 5).map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])));

async function record(sc) {
  const monitor = new pg.Client({ connectionString: url });
  await monitor.connect();
  const version = (await monitor.query('select version() as v')).rows[0].v.split(' on ')[0];
  await monitor.query('drop schema if exists public cascade; create schema public;');
  await monitor.query(sc.setup);
  const sessions = {};
  const pids = {};
  for (const s of sc.sessions) {
    sessions[s] = new pg.Client({ connectionString: url, application_name: `session ${s}` });
    await sessions[s].connect();
    pids[s] = (await sessions[s].query('select pg_backend_pid() as p')).rows[0].p;
  }
  const label = Object.fromEntries(Object.entries(pids).map(([s, p]) => [p, s]));
  const pending = {};
  const events = [];
  const t0 = Date.now();
  const problems = [];

  const outcome = (r) => (r.error ? { status: 'error', error: r.error.message, code: r.error.code } : { status: 'ok', command: r.result.command, rowCount: r.result.rowCount, rows: shortRows(r.result) });
  const locks = async () => {
    const r = await monitor.query(`
      select l.pid, l.locktype, l.mode, l.granted,
             case when l.relation is not null then l.relation::regclass::text end as relation,
             l.transactionid::text as xid, l.objid::text as objid, pg_blocking_pids(l.pid) as blocked_by
      from pg_locks l
      where l.pid = any($1) and l.locktype in ('relation', 'transactionid', 'tuple', 'advisory')
        and (l.relation is null or l.relation::regclass::text not like 'pg_%')
        and not (l.locktype = 'relation' and l.relation::regclass::text like '%_pkey' and l.granted)
      order by l.pid, l.granted desc, l.locktype`, [Object.values(pids)]);
    return r.rows.map((x) => ({ session: label[x.pid], type: x.locktype, mode: x.mode, granted: x.granted, on: x.relation ?? (x.xid ? `transaction ${x.xid}` : x.objid ? `advisory ${x.objid}` : ''), blockedBy: (x.blocked_by ?? []).map((p) => label[p]).filter(Boolean) }));
  };
  // A session that was waiting may have finished in the meantime.
  const collect = async () => {
    for (const [s, p] of Object.entries(pending)) {
      const done = await Promise.race([p, sleep(60).then(() => null)]);
      if (done) { delete pending[s]; events.push({ at: Date.now() - t0, session: s, kind: 'resumed', sql: done.sql, ...outcome(done) }); }
    }
  };

  for (const [i, step] of sc.steps.entries()) {
    if (pending[step.s]) { problems.push(`step ${i + 1}: session ${step.s} is still waiting and cannot run another statement`); break; }
    const p = sessions[step.s].query(step.sql).then((result) => ({ sql: step.sql, result }), (error) => ({ sql: step.sql, error }));
    const done = await Promise.race([p, sleep(step.expect === 'either' ? DEADLOCK_MS : WAIT_MS).then(() => null)]);
    await sleep(120); // let anything this step released catch up
    let status;
    if (done) {
      const o = outcome(done);
      status = o.status;
      events.push({ at: Date.now() - t0, step: i, session: step.s, kind: 'statement', sql: step.sql, note: step.note ?? '', ...o });
    } else {
      pending[step.s] = p;
      status = 'waits';
      events.push({ at: Date.now() - t0, step: i, session: step.s, kind: 'statement', sql: step.sql, note: step.note ?? '', status: 'waiting' });
    }
    await collect();
    events[events.findLastIndex((e) => e.step === i)].locks = await locks();
    if (step.expect !== 'either' && step.expect !== status) problems.push(`step ${i + 1} (${step.s}: ${step.sql}): expected ${step.expect}, got ${status}${done?.error ? ` (${done.error.message})` : ''}`);
  }
  await sleep(300);
  await collect();
  for (const s of Object.keys(pending)) problems.push(`session ${s} was still waiting at the end`);
  for (const c of Object.values(sessions)) await c.end().catch(() => {});
  await monitor.end();
  return { problems, trace: { id: sc.id, title: sc.title, engine: version, recorded: new Date().toISOString().slice(0, 10), scenario: crypto.createHash('sha1').update(JSON.stringify(sc)).digest('hex').slice(0, 16), sessions: sc.sessions, setup: sc.setup.trim(), events } };
}

let failed = 0;
try {
  fs.mkdirSync(OUT, { recursive: true });
  for (const sc of scenarios) {
    if (only && sc.id !== only) continue;
    const { problems, trace } = await record(sc);
    if (problems.length) { failed++; console.error(`✗ ${sc.id}\n  ${problems.join('\n  ')}`); continue; }
    fs.writeFileSync(path.join(OUT, `${sc.id}.json`), JSON.stringify(trace, null, 1) + '\n');
    console.log(`✓ ${sc.id}: ${trace.events.length} events on ${trace.engine}`);
  }
} finally {
  if (container) execFileSync('docker', ['stop', container], { stdio: 'ignore' });
}
process.exit(failed ? 1 : 0);
