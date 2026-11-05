// Rules for query-tuning exercises. Whether each one is actually solvable (the slow query fails its checks and the
// stated solution passes) is proved by tests/unit/db-exercises.test.ts, which runs them on the real engine.
import { rules } from './rules.mjs';
import { checkProblem } from '../../src/lib/db/checks.ts';
import { checkSignOff } from './signoff.mjs';

/** @param {{ dbExercises?: {slug: string, file: string, data: any, error?: string}[], pages?: {path: string, html: string}[] }} ctx */
export function validateDbExercises({ dbExercises = [], pages = [] }) {
  const { check, problems } = rules();
  const ids = new Set();
  const str = (v, min = 1) => typeof v === 'string' && v.trim().length >= min;
  for (const item of dbExercises) {
    const where = item.file;
    if (item.error) { problems.push(`${where}: could not parse (${item.error})`); continue; }
    const d = item.data;
    if (!d || typeof d !== 'object') { problems.push(`${where}: file is empty`); continue; }
    check(typeof d.id === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.id), `${where}: id must be lowercase words joined by hyphens`);
    check(d.id === item.slug, `${where}: id should match the file name`);
    check(!ids.has(d.id), `${where}: id "${d.id}" is used twice`);
    ids.add(d.id);
    check(str(d.title, 5), `${where}: needs a title`);
    check([1, 2, 3].includes(d.difficulty), `${where}: difficulty must be 1, 2 or 3`);
    check(str(d.scenario, 20), `${where}: needs a scenario (what is slow, and for whom)`);
    check(str(d.task, 10), `${where}: needs a task`);
    check(str(d.query, 10), `${where}: needs the original query`);
    check(!/;\s*\S/.test(String(d.query ?? '').trim().replace(/;\s*$/, '')), `${where}: the query must be a single statement`);
    check(typeof d.reviewed === 'boolean', `${where}: "reviewed" must be true or false`);
    checkSignOff(d, where, check);
    check(d.ordered === undefined || typeof d.ordered === 'boolean', `${where}: "ordered" must be true or false`);
    check(d.allowChanges === undefined || typeof d.allowChanges === 'boolean', `${where}: "allowChanges" must be true or false`);
    check(Array.isArray(d.checks) && d.checks.length > 0, `${where}: needs at least one check`);
    for (const c of Array.isArray(d.checks) ? d.checks : []) { const p = checkProblem(c); if (p) problems.push(`${where}: ${p}`); }
    check(Array.isArray(d.hints) && d.hints.length >= 2 && d.hints.length <= 4 && d.hints.every((h) => str(h, 5)), `${where}: needs two to four hints, from a nudge to the answer`);
    check(d.solution && typeof d.solution === 'object' && (str(d.solution.changes) || str(d.solution.query)), `${where}: the solution needs changes, a query, or both`);
    check(!(d.solution?.changes && !d.allowChanges), `${where}: the solution makes changes, so set allowChanges: true`);
    check(str(d.why, 40), `${where}: needs a "why" that explains what made it slow`);
    if (d.page !== undefined) check(pages.some((p) => p.path === d.page), `${where}: page "${d.page}" is not a page on this site`);
  }
  // every exercise a page embeds must exist
  for (const p of pages) for (const m of p.html.matchAll(/data-widget="sql-exercise" data-id="([^"]+)"/g)) {
    check(ids.has(m[1]), `${p.path}: embeds exercise "${m[1]}", which does not exist`);
  }
  return problems;
}
