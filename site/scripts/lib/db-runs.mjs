// Runs the SQL examples in the Databases pages against the real sample database, at build time, and
// returns what the engine actually printed. Nothing shown as output on those pages is typed by hand.
//
// In a page, a fenced block whose language is `sql` and whose info string names a kind is run:
//   ```sql run              -> the result rows (first ROW_LIMIT)
//   ```sql explain          -> EXPLAIN output (the plan, without running the query)
//   ```sql explain-analyze  -> EXPLAIN (ANALYZE, BUFFERS) output (the plan, run, with real counts and timings)
//   ```sql plan-tree        -> like explain-analyze, plus the plan as JSON for the step-by-step plan viewer
//   ```sql setup            -> run for its effect (for example CREATE INDEX); nothing is printed
// Add `hidden` to a setup block to run it without showing the SQL.
//
// The blocks of one page run in order, in one transaction that is rolled back afterwards, so an index made
// on one page never leaks into another. Results are cached in data/db-runs.json, keyed by the seed, the
// engine version and every statement up to that point, so builds are repeatable and fast. Set DB_RERUN=1 to
// run everything again (timings will change; plan shapes should not).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const RUN_KINDS = ['run', 'explain', 'explain-analyze', 'plan-tree', 'setup'];
export const ROW_LIMIT = 10;

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const stripSemi = (sql) => sql.trim().replace(/;\s*$/, '');

/** Parse a code block's info string: "explain-analyze", "setup hidden". Returns null if it is not a runnable block. */
export function parseRunMeta(lang, meta) {
  if (lang !== 'sql' || !meta) return null;
  const words = meta.trim().split(/\s+/);
  const kind = words.find((w) => RUN_KINDS.includes(w));
  if (!kind) return null;
  return { kind, hidden: words.includes('hidden') };
}

export function createDbRunner({ siteDir, warn, force = !!process.env.DB_RERUN }) {
  const cacheFile = path.join(siteDir, 'data', 'db-runs.json');
  const seed = fs.readFileSync(path.join(siteDir, 'content', 'databases', 'seed.sql'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(siteDir, 'node_modules', '@electric-sql', 'pglite', 'package.json'), 'utf8'));
  const salt = `${sha(seed)}:${pkg.version}`;
  const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : { engine: null, entries: {} };
  const used = new Set();
  let changed = false;
  let db = null;

  async function open() {
    if (db) return db;
    const { PGlite } = await import('@electric-sql/pglite');
    db = new PGlite();
    await db.waitReady;
    await db.exec(seed);
    await db.exec('vacuum analyze'); // separate: VACUUM cannot run inside a multi-statement string
    const v = (await db.query('select version() as v')).rows[0].v;
    const engine = v.slice(0, v.indexOf(')') + 1); // "PostgreSQL 18.6 (PGlite 0.5.9)"
    if (cache.engine !== engine) { cache.engine = engine; changed = true; }
    return db;
  }

  async function execBlock(d, kind, sql) {
    if (kind === 'setup') { await d.exec(sql); return { kind }; }
    if (kind === 'run') {
      const results = await d.exec(sql);
      const last = results[results.length - 1];
      const columns = (last.fields ?? []).map((f) => f.name);
      const rows = (last.rows ?? []).slice(0, ROW_LIMIT).map((r) => columns.map((c) => (r[c] === null ? 'NULL' : r[c] instanceof Date ? r[c].toISOString().replace('T', ' ').replace(/\.000Z$/, '+00') : String(r[c]))));
      return { kind, columns, rows, total: (last.rows ?? []).length };
    }
    if (kind === 'plan-tree') {
      const j = await d.query('explain (analyze, buffers, format json) ' + stripSemi(sql));
      const t = await d.query('explain (analyze, buffers) ' + stripSemi(sql));
      return { kind, plan: j.rows[0]['QUERY PLAN'][0].Plan, text: t.rows.map((x) => x['QUERY PLAN']).join('\n') };
    }
    const prefix = kind === 'explain' ? 'explain ' : 'explain (analyze, buffers) ';
    const r = await d.query(prefix + stripSemi(sql));
    return { kind, text: r.rows.map((x) => x['QUERY PLAN']).join('\n') };
  }

  /**
   * Run one page's blocks. `blocks` is [{ kind, sql }] in page order. Returns one output per block,
   * or null for a block that failed (the failure is reported through `warn` as fatal).
   */
  async function runPage(pageName, blocks) {
    const keys = blocks.map((_, i) => sha(`${salt}:${pageName}:${JSON.stringify(blocks.slice(0, i + 1))}`));
    keys.forEach((k) => used.add(k));
    if (!force && keys.every((k) => cache.entries[k])) return keys.map((k) => cache.entries[k]);
    const d = await open();
    const outputs = [];
    await d.exec('begin');
    try {
      for (let i = 0; i < blocks.length; i++) {
        const { kind, sql } = blocks[i];
        try {
          const out = { ...(await execBlock(d, kind, sql)), at: new Date().toISOString().slice(0, 10) };
          cache.entries[keys[i]] = out;
          outputs.push(out);
          changed = true;
        } catch (e) {
          warn(`${pageName}: SQL block ${i + 1} (${kind}) failed: ${e.message}`, true);
          outputs.push(null);
          // a failed statement aborts the transaction; start a fresh one so later blocks still run
          await d.exec('rollback'); await d.exec('begin');
        }
      }
    } finally {
      await d.exec('rollback');
      // A rolled-back change still clears the all-visible bits of the pages it touched. Vacuum so the next page
      // starts from a settled database, exactly as a fresh one would (index-only scans need no heap fetches).
      await d.exec('vacuum');
    }
    return outputs;
  }

  async function close() {
    for (const k of Object.keys(cache.entries)) if (!used.has(k)) { delete cache.entries[k]; changed = true; }
    if (changed) {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      const sorted = { engine: cache.engine, entries: Object.fromEntries(Object.entries(cache.entries).sort(([a], [b]) => a.localeCompare(b))) };
      fs.writeFileSync(cacheFile, JSON.stringify(sorted, null, 1) + '\n');
    }
    if (db) await db.close();
  }

  return { runPage, close, engine: () => cache.engine };
}

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** HTML for one output. The SQL itself is shown by the normal code block just above it. */
export function outputHtml(out, engine) {
  if (!out || out.kind === 'setup') return '';
  const by = `real output from ${escHtml(engine ?? 'the sample database')}`;
  if (out.kind === 'run') {
    const more = out.total > out.rows.length ? `first ${out.rows.length} of ${out.total} rows` : `${out.total} row${out.total === 1 ? '' : 's'}`;
    const table = out.columns.length
      ? `<table class="db-table"><thead><tr>${out.columns.map((c) => `<th>${escHtml(c)}</th>`).join('')}</tr></thead><tbody>${out.rows.map((r) => `<tr>${r.map((v) => `<td>${escHtml(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      : '<p class="db-none">The statement ran and returned no rows.</p>';
    return `<figure class="db-run" data-kind="run"><figcaption><b>Result</b> <span>${more}; ${by}</span></figcaption>${table}</figure>`;
  }
  if (out.kind === 'plan-tree') {
    const json = JSON.stringify(out.plan).replace(/</g, '\\u003c'); // so plan text can never close the script tag
    return `<figure class="db-run" data-kind="plan-tree"><figcaption><b>Plan, executed</b> <span>${by}. Step through it below</span></figcaption><div class="widget-host db-plan-host" data-widget="plan-tree"><script type="application/json">${json}</script><pre class="db-out" tabindex="0" role="region" aria-label="Plan, executed">${escHtml(out.text)}</pre></div></figure>`;
  }
  const label = out.kind === 'explain' ? 'Plan' : 'Plan, executed';
  const note = out.kind === 'explain-analyze' ? `${by}. Timings depend on the machine; the shape and the row counts do not` : by;
  return `<figure class="db-run" data-kind="${out.kind}"><figcaption><b>${label}</b> <span>${note}</span></figcaption><pre class="db-out" tabindex="0" role="region" aria-label="${label}">${escHtml(out.text)}</pre></figure>`; // plain pre: not re-highlighted as source code
}
