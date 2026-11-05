// Loading and emitting "try it first" content: rubrics per solution step and follow-up questions.
import fs from 'node:fs';
import path from 'node:path';
import { load as loadYaml } from 'js-yaml';

export function loadPractice(siteDir) {
  const dir = path.join(siteDir, 'content', 'practice');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => {
    const file = `content/practice/${f}`;
    const slug = f.replace(/\.ya?ml$/, '');
    try { return { slug, file, data: loadYaml(fs.readFileSync(path.join(dir, f), 'utf8')) }; }
    catch (e) { return { slug, file, data: null, error: e.message.split('\n')[0] }; }
  });
}

/** Write one JSON file per solution for the practice interface, and attach the follow-ups to the page for static rendering. */
export function emitPractice(items, siteDir, pages, base) {
  const dir = path.join(siteDir, 'public', 'data', 'practice');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let count = 0;
  for (const it of items) {
    const page = pages.find((p) => p.path === it.data?.solution);
    if (!page) continue;
    const reviewed = it.data.reviewed === true;
    fs.writeFileSync(path.join(dir, `${it.slug}.json`), JSON.stringify({
      slug: it.slug, solution: page.path, reviewed,
      steps: (it.data.steps ?? []).map(({ id, prompt, rubric }) => ({ id, prompt, rubric })),
    }));
    page.practice = { src: `${base}data/practice/${it.slug}.json`, reviewed, steps: (it.data.steps ?? []).length, followups: it.data.followups ?? [] };
    count++;
  }
  return count;
}
