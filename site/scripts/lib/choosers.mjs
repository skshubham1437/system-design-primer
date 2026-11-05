// Loading and emitting decision aids ("choosers"): a guided question tree plus test-yourself scenarios.
import fs from 'node:fs';
import path from 'node:path';
import { load as loadYaml } from 'js-yaml';

export function loadChoosers(siteDir) {
  const dir = path.join(siteDir, 'content', 'choosers');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => {
    const file = `content/choosers/${f}`;
    const slug = f.replace(/\.ya?ml$/, '');
    try { return { slug, file, data: loadYaml(fs.readFileSync(path.join(dir, f), 'utf8')) }; }
    catch (e) { return { slug, file, data: null, error: e.message.split('\n')[0] }; }
  });
}

export function emitChoosers(items, siteDir, pages, base) {
  const dir = path.join(siteDir, 'public', 'data', 'chooser');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const index = [];
  for (const it of items) {
    const d = it.data;
    const page = pages.find((p) => p.path === d?.topic);
    if (!page) continue;
    const payload = {
      id: d.id, title: d.title, topic: page.path, reviewed: d.reviewed === true, intro: d.intro ?? '',
      start: d.tree.start, nodes: d.tree.nodes, results: d.results, scenarios: d.scenarios,
    };
    fs.writeFileSync(path.join(dir, `${d.id}.json`), JSON.stringify(payload));
    page.chooser = { id: d.id, title: d.title, src: `${base}data/chooser/${d.id}.json`, reviewed: payload.reviewed, scenarios: d.scenarios.length };
    index.push({ id: d.id, title: d.title, topic: page.path, scenarios: d.scenarios.length });
  }
  return index;
}
