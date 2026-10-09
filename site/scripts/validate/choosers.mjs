// Rules for decision aids. A chooser that dead-ends, loops, or recommends something it never explains is worse than none.
import { rules } from './rules.mjs';

/**
 * @param {{ choosers?: {slug: string, file: string, data: any, error?: string}[], pages?: {path: string, html: string}[] }} ctx
 * @returns {string[]} problems
 */
export function validateChoosers({ choosers = [], pages = [] }) {
  const { check, problems } = rules();
  const ids = new Set();

  for (const item of choosers) {
    const where = item.file;
    if (item.error) { problems.push(`${where}: could not parse (${item.error})`); continue; }
    const d = item.data;
    if (!d || typeof d !== 'object') { problems.push(`${where}: file is empty`); continue; }

    check(typeof d.id === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.id), `${where}: id must be lowercase words joined by hyphens`);
    check(d.id === item.slug, `${where}: id should match the file name`);
    check(!ids.has(d.id), `${where}: id "${d.id}" is used twice`);
    ids.add(d.id);
    check(typeof d.title === 'string' && d.title.trim().length >= 5, `${where}: needs a title`);
    check(typeof d.reviewed === 'boolean', `${where}: "reviewed" must be true or false`);

    const page = pages.find((p) => p.path === d.topic);
    check(!!page, `${where}: topic "${d.topic}" is not a page on this site`);
    const headingIds = new Set(page ? [...page.html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]) : []);

    // ---- results
    const results = d.results && typeof d.results === 'object' ? d.results : {};
    check(Object.keys(results).length >= 2, `${where}: needs at least 2 results`);
    for (const [rid, r] of Object.entries(results)) {
      const at = `${where} result "${rid}"`;
      check(r && typeof r.title === 'string' && r.title.trim().length >= 5, `${at}: needs a title`);
      check(r && typeof r.why === 'string' && r.why.trim().length >= 40, `${at}: "why" is missing or too short`);
      check(r && Array.isArray(r.tradeoffs) && r.tradeoffs.length >= 2 && r.tradeoffs.length <= 4 && r.tradeoffs.every((t) => typeof t === 'string' && t.trim().length >= 15), `${at}: needs 2 to 4 trade-offs (a recommendation with no downside is not honest)`);
      if (r?.link !== undefined) check(typeof r.link === 'string' && r.link.startsWith('#') && headingIds.has(r.link.slice(1)), `${at}: link "${r.link}" does not match a heading on ${d.topic}`);
    }

    // ---- tree
    const tree = d.tree;
    const nodes = tree?.nodes && typeof tree.nodes === 'object' ? tree.nodes : {};
    check(typeof tree?.start === 'string' && tree.start in nodes, `${where}: tree.start must name a node`);
    const usedResults = new Set();
    for (const [nid, n] of Object.entries(nodes)) {
      const at = `${where} node "${nid}"`;
      check(n && typeof n.ask === 'string' && n.ask.trim().length >= 15, `${at}: the question is missing or too short`);
      const opts = n?.options;
      check(Array.isArray(opts) && opts.length >= 2 && opts.length <= 5, `${at}: needs 2 to 5 options`);
      if (!Array.isArray(opts)) continue;
      opts.forEach((o, i) => {
        const oa = `${at} option ${i + 1}`;
        check(o && typeof o.label === 'string' && o.label.trim().length >= 2, `${oa}: needs a label`);
        const hasNext = o && o.next !== undefined, hasResult = o && o.result !== undefined;
        check(hasNext !== hasResult, `${oa}: needs exactly one of "next" or "result"`);
        if (hasNext) check(o.next in nodes, `${oa}: next "${o.next}" is not a node`);
        if (hasResult) { check(o.result in results, `${oa}: result "${o.result}" is not defined`); usedResults.add(o.result); }
      });
    }

    // every node must be reachable from the start, and the tree must not loop
    const reach = new Set();
    const walking = new Set();
    const visit = (id) => {
      if (walking.has(id)) { problems.push(`${where}: the question tree loops back to "${id}"`); return; }
      if (reach.has(id) || !(id in nodes)) return;
      reach.add(id); walking.add(id);
      for (const o of nodes[id]?.options ?? []) if (o?.next !== undefined) visit(o.next);
      walking.delete(id);
    };
    if (tree?.start in nodes) visit(tree.start);
    for (const nid of Object.keys(nodes)) check(reach.has(nid), `${where}: node "${nid}" can never be reached`);
    for (const rid of Object.keys(results)) check(usedResults.has(rid), `${where}: result "${rid}" is never recommended`);

    // ---- scenarios
    const sc = d.scenarios;
    check(Array.isArray(sc) && sc.length >= 4 && sc.length <= 10, `${where}: needs 4 to 10 scenarios`);
    if (Array.isArray(sc)) {
      const seen = new Set();
      sc.forEach((s, i) => {
        const at = `${where} scenario ${i + 1}${s?.id ? ` (${s.id})` : ''}`;
        check(s && typeof s.id === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.id) && !seen.has(s.id), `${at}: needs a unique lowercase id`);
        if (s?.id) seen.add(s.id);
        check(s && typeof s.scenario === 'string' && s.scenario.trim().length >= 40, `${at}: describe the situation in at least a sentence`);
        const o = s?.options;
        check(Array.isArray(o) && o.length >= 3 && o.length <= 5, `${at}: needs 3 to 5 options`);
        if (Array.isArray(o)) {
          o.forEach((x, j) => {
            check(x && typeof x.label === 'string' && x.label.trim(), `${at} option ${j + 1}: needs a label`);
            check(x && typeof x.why === 'string' && x.why.trim().length >= 25, `${at} option ${j + 1}: explain why it is right or wrong`);
          });
          check(Number.isInteger(s.answer) && s.answer >= 0 && s.answer < o.length, `${at}: "answer" must be the index of one option`);
        }
      });
      const counts = {};
      for (const s of sc) if (Number.isInteger(s?.answer)) counts[s.answer] = (counts[s.answer] ?? 0) + 1;
      check(sc.length < 4 || Math.max(0, ...Object.values(counts)) / sc.length <= 0.6, `${where}: the best option is in the same position too often; vary it`);
    }
  }
  return problems;
}
