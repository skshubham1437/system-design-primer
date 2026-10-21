// "At production scale" recordings (data/db-scale/*.json, made by scripts/record-scale.mjs): the same queries as
// some pages, run on the sample shop at 100 times the size on a real PostgreSQL server. A recording made from an
// older version of its scenario, or of the 100x seed, would no longer show what the page describes, so the build
// refuses it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { load as loadYaml } from 'js-yaml';

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const escHtml = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function loadScaleRuns(siteDir) {
  const dir = path.join(siteDir, 'content', 'databases');
  const scenarios = loadYaml(fs.readFileSync(path.join(dir, 'scale-runs.yaml'), 'utf8')) ?? [];
  const seed = hash(fs.readFileSync(path.join(dir, 'seed-scale.sql'), 'utf8'));
  return scenarios.map((sc) => {
    const file = path.join(siteDir, 'data', 'db-scale', `${sc.id}.json`);
    const run = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    return { id: sc.id, page: sc.page, run, current: !!run && run.scenario === hash(JSON.stringify(sc)) && run.seed === seed };
  });
}

/** The static figure a page shows for <div data-widget="db-scale" data-id="..."></div>. */
export function scaleHtml(run) {
  const n = (v) => Number(v).toLocaleString('en-US');
  const steps = run.steps.map((s) => (s.kind === 'setup'
    ? `<pre class="db-scale-sql" tabindex="0" role="region" aria-label="Setup">${escHtml(s.sql)}</pre>`
    : `<p class="db-scale-step"><b>${escHtml(s.label)}</b></p><pre class="db-scale-sql" tabindex="0" role="region" aria-label="${escHtml(s.label)}: query">${escHtml(s.sql)}</pre><pre class="db-out" tabindex="0" role="region" aria-label="${escHtml(s.label)}: plan">${escHtml(s.text)}</pre>`)).join('');
  return `<figure class="db-scale" data-scale="${escHtml(run.id)}"><figcaption><b>At production scale:</b> ${escHtml(run.title)} <span>${n(run.sizes.users)} users and ${n(run.sizes.orders)} orders, recorded on ${escHtml(run.engine.replace(/ [(].*$/, ''))} on ${escHtml(run.recorded)}. Each plan is the second of two runs, so the data was already in memory.</span></figcaption>${steps}</figure>`;
}

/** @param {{ dbScale?: {id: string, page: string, run: any, current: boolean}[], pages?: {path: string, html: string}[] }} ctx */
export function validateScaleRuns({ dbScale = [], pages = [] }) {
  const problems = [];
  for (const s of dbScale) {
    if (!s.run) problems.push(`scale run "${s.id}" has no recording; run node scripts/record-scale.mjs ${s.id}`);
    else if (!s.current) problems.push(`scale run "${s.id}" or the 100x seed changed since it was recorded; run node scripts/record-scale.mjs`);
  }
  const ids = new Set(dbScale.filter((s) => s.run).map((s) => s.id));
  for (const p of pages) for (const m of p.html.matchAll(/data-widget="db-scale" data-id="([^"]+)"|data-scale="([^"]+)"/g)) {
    const id = m[1] ?? m[2];
    if (!ids.has(id)) problems.push(`${p.path}: shows scale run "${id}", which does not exist`);
    const sc = dbScale.find((s) => s.id === id);
    if (sc && sc.page !== p.path) problems.push(`${p.path}: shows scale run "${id}", which scale-runs.yaml assigns to ${sc.page}`);
  }
  return problems;
}
