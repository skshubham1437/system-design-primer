// Loading and emitting query-tuning exercises (content/databases/exercises/*.yaml).
// Validation lives in scripts/validate/db-exercises.mjs; the checks themselves run in the browser.
import fs from 'node:fs';
import path from 'node:path';
import { load as loadYaml } from 'js-yaml';

export function loadDbExercises(siteDir) {
  const dir = path.join(siteDir, 'content', 'databases', 'exercises');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => {
    const file = `content/databases/exercises/${f}`;
    const slug = f.replace(/\.ya?ml$/, '');
    try { return { slug, file, data: loadYaml(fs.readFileSync(path.join(dir, f), 'utf8')) }; }
    catch (e) { return { slug, file, data: null, error: e.message.split('\n')[0] }; }
  });
}

/** One JSON file per exercise plus an index, fetched by the exercise widget when a page needs it. */
export function emitDbExercises(items, siteDir) {
  const dir = path.join(siteDir, 'public', 'data', 'db', 'exercises');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const index = [];
  for (const it of items) {
    const d = it.data;
    if (!d?.id) continue;
    const payload = {
      id: d.id, title: d.title, difficulty: d.difficulty, scenario: d.scenario, task: d.task, setup: d.setup ?? '',
      query: d.query, ordered: d.ordered === true, allowChanges: d.allowChanges === true, checks: d.checks,
      hints: d.hints, solution: d.solution, why: d.why, page: d.page ?? null, reviewed: d.reviewed === true,
    };
    fs.writeFileSync(path.join(dir, `${d.id}.json`), JSON.stringify(payload));
    index.push({ id: d.id, title: d.title, difficulty: d.difficulty, page: d.page ?? null, reviewed: payload.reviewed });
  }
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index));
  return index;
}
