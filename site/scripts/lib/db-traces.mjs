// Recorded concurrency traces (data/db-traces/*.json, made by scripts/record-traces.mjs): publish them for the
// replay widget and check that each one is current. A trace recorded from an older version of its scenario would
// show a run that no longer matches the page's description, so the build refuses it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { load as loadYaml } from 'js-yaml';

export function loadTraces(siteDir) {
  const scenarios = loadYaml(fs.readFileSync(path.join(siteDir, 'content', 'databases', 'concurrency-scenarios.yaml'), 'utf8')) ?? [];
  const dir = path.join(siteDir, 'data', 'db-traces');
  return scenarios.map((sc) => {
    const file = path.join(dir, `${sc.id}.json`);
    const trace = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    const hash = crypto.createHash('sha1').update(JSON.stringify(sc)).digest('hex').slice(0, 16);
    return { id: sc.id, trace, current: !!trace && trace.scenario === hash };
  });
}

export function emitTraces(traces, siteDir) {
  const dir = path.join(siteDir, 'public', 'data', 'db', 'traces');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const t of traces) if (t.trace) fs.writeFileSync(path.join(dir, `${t.id}.json`), JSON.stringify(t.trace));
}

/** @param {{ dbTraces?: {id: string, trace: any, current: boolean}[], pages?: {path: string, html: string}[] }} ctx */
export function validateTraces({ dbTraces = [], pages = [] }) {
  const problems = [];
  for (const t of dbTraces) {
    if (!t.trace) problems.push(`concurrency scenario "${t.id}" has no recording; run node scripts/record-traces.mjs`);
    else if (!t.current) problems.push(`concurrency scenario "${t.id}" changed since it was recorded; run node scripts/record-traces.mjs ${t.id}`);
  }
  const ids = new Set(dbTraces.filter((t) => t.trace).map((t) => t.id));
  for (const p of pages) for (const m of p.html.matchAll(/data-widget="tx-trace" data-id="([^"]+)"/g)) {
    if (!ids.has(m[1])) problems.push(`${p.path}: replays trace "${m[1]}", which does not exist`);
  }
  return problems;
}
