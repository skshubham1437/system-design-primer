// Rules for the "Before this" map in site-map.mjs: every path must be a real page, and no chain may loop.
import { rules } from './rules.mjs';
import { PREREQS } from '../site-map.mjs';

/** @param {{ pages?: {path: string}[], prereqs?: Record<string, string[]> }} ctx */
export function validatePrereqs({ pages = [], prereqs = PREREQS }) {
  const { check, problems } = rules();
  const known = new Set(pages.map((p) => p.path));
  for (const [page, list] of Object.entries(prereqs)) {
    check(known.has(page), `"${page}" is not a page`);
    check(new Set(list).size === list.length, `"${page}" lists the same prerequisite twice`);
    for (const dep of list) {
      check(known.has(dep), `"${page}" needs "${dep}", which is not a page`);
      check(dep !== page, `"${page}" lists itself as a prerequisite`);
    }
  }
  // cycle check: depth-first walk with a visiting set
  const state = new Map();
  const visit = (node, trail) => {
    if (state.get(node) === 'done') return;
    if (state.get(node) === 'visiting') { problems.push(`prerequisites loop: ${[...trail, node].join(' -> ')}`); return; }
    state.set(node, 'visiting');
    for (const dep of prereqs[node] ?? []) visit(dep, [...trail, node]);
    state.set(node, 'done');
  };
  for (const page of Object.keys(prereqs)) visit(page, []);
  return problems;
}
