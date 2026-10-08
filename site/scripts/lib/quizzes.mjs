// Loading and emitting quiz content. Validation lives in scripts/validate/quizzes.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { load as loadYaml } from 'js-yaml';

/** Read every content/quizzes/*.yaml. Parse errors are returned (not thrown) so the validator can report them. */
export function loadQuizzes(siteDir) {
  const dir = path.join(siteDir, 'content', 'quizzes');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => {
    const file = `content/quizzes/${f}`;
    const slug = f.replace(/\.ya?ml$/, '');
    try { return { slug, file, data: loadYaml(fs.readFileSync(path.join(dir, f), 'utf8')) }; }
    catch (e) { return { slug, file, data: null, error: e.message.split('\n')[0] }; }
  });
}

/**
 * Write one JSON file per quiz plus an index into public/data/quiz/, and tag each topic page with its quiz.
 * The browser fetches these on demand, so topic pages stay light.
 */
export function emitQuizzes(quizzes, siteDir, pages, base) {
  const dir = path.join(siteDir, 'public', 'data', 'quiz');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const index = [];
  for (const q of quizzes) {
    if (!q.data?.topic) continue;
    const page = pages.find((p) => p.path === q.data.topic);
    if (!page) continue;
    const payload = {
      slug: q.slug, topic: page.path, title: page.title, reviewed: q.data.reviewed === true,
      questions: (q.data.questions ?? []).map(({ id, q: text, choices, answer, why, link, difficulty }) => ({ id, q: text, choices, answer, why, link, difficulty: difficulty ?? 1 })),
    };
    fs.writeFileSync(path.join(dir, `${q.slug}.json`), JSON.stringify(payload));
    index.push({ slug: q.slug, topic: page.path, title: page.title, count: payload.questions.length, reviewed: payload.reviewed, ids: payload.questions.map((x) => x.id) });
    page.quiz = { slug: q.slug, count: payload.questions.length, reviewed: payload.reviewed, src: `${base}data/quiz/${q.slug}.json` };
  }
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index));
  return index;
}
