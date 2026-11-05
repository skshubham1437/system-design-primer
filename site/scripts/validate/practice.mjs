// Rules for practice files (rubrics and follow-up questions for a solution).
import { rules } from './rules.mjs';

/**
 * @param {{ practice?: {slug: string, file: string, data: any, error?: string}[], pages?: {path: string, kind: string, html: string}[] }} ctx
 * @returns {string[]} problems
 */
export function validatePractice({ practice = [], pages = [] }) {
  const { check, problems } = rules();

  for (const item of practice) {
    const where = item.file;
    if (item.error) { problems.push(`${where}: could not parse (${item.error})`); continue; }
    const d = item.data;
    if (!d || typeof d !== 'object') { problems.push(`${where}: file is empty`); continue; }

    const page = pages.find((p) => p.path === d.solution);
    check(!!page && page.kind === 'solution', `${where}: "${d.solution}" is not a solution page on this site`);
    check(typeof d.reviewed === 'boolean', `${where}: "reviewed" must be true or false (true only after a second person signed off)`);

    // the step sections the page actually has (every H2 is wrapped as <section data-step="id">)
    const sections = page ? [...page.html.matchAll(/<section class="sol-step" data-step="([^"]+)"/g)].map((m) => m[1]) : [];
    const stepSections = sections.filter((id) => /^step-\d/.test(id));
    const steps = d.steps;
    if (!Array.isArray(steps) || steps.length === 0) { problems.push(`${where}: "steps" must be a non-empty list`); }
    else {
      const seen = new Set();
      steps.forEach((s, i) => {
        const at = `${where} step ${i + 1}${s?.id ? ` (${s.id})` : ''}`;
        if (!s || typeof s !== 'object') { problems.push(`${at}: must be an object`); return; }
        check(typeof s.id === 'string' && sections.includes(s.id), `${at}: id must match a step heading on the solution page`);
        check(!seen.has(s.id), `${at}: step listed twice`);
        seen.add(s.id);
        check(typeof s.prompt === 'string' && s.prompt.trim().length >= 25, `${at}: the prompt is missing or too short`);
        const r = s.rubric;
        check(Array.isArray(r) && r.length >= 3 && r.length <= 7 && r.every((x) => typeof x === 'string' && x.trim().length >= 12), `${at}: needs 3 to 7 rubric items of at least 12 characters`);
        if (Array.isArray(r)) check(new Set(r.map((x) => String(x).trim().toLowerCase())).size === r.length, `${at}: duplicate rubric items`);
      });
      for (const id of stepSections) check(seen.has(id), `${where}: the page has "${id}" but the practice file does not cover it`);
    }

    const f = d.followups;
    check(Array.isArray(f) && f.length >= 3 && f.length <= 8, `${where}: needs 3 to 8 follow-up questions`);
    if (Array.isArray(f)) f.forEach((x, i) => {
      const at = `${where} follow-up ${i + 1}`;
      check(x && typeof x.q === 'string' && x.q.trim().length >= 15, `${at}: the question is missing or too short`);
      check(x && typeof x.a === 'string' && x.a.trim().length >= 40, `${at}: the answer is missing or too short (explain the reasoning)`);
    });
  }
  return problems;
}
