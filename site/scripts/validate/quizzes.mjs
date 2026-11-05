// Rules for quiz files. Every rule exists because a broken quiz teaches the wrong thing or fails silently.
import { rules } from './rules.mjs';
import { checkSignOff } from './signoff.mjs';

export const QUESTIONS_MIN = 5;
export const QUESTIONS_MAX = 10;
/** The right answer may be at most this many times as long as the longest wrong one. */
export const ANSWER_LENGTH_RATIO = 1.3;
/** In one file, the right answer may be the longest choice in at most this share of questions. */
export const LONGEST_ANSWER_SHARE = 0.4;

/**
 * @param {{ quizzes?: {slug: string, file: string, data: any, error?: string}[], pages?: {path: string, html: string}[] }} ctx
 * @returns {string[]} problems
 */
export function validateQuizzes({ quizzes = [], pages = [] }) {
  const { check, problems } = rules();
  const seenIds = new Map(); // question id -> file

  for (const quiz of quizzes) {
    const where = quiz.file;
    if (quiz.error) { problems.push(`${where}: could not parse (${quiz.error})`); continue; }
    const d = quiz.data;
    if (!d || typeof d !== 'object') { problems.push(`${where}: file is empty`); continue; }

    const page = pages.find((p) => p.path === d.topic);
    check(!!page, `${where}: topic "${d.topic}" is not a page on this site`);
    check(typeof d.reviewed === 'boolean', `${where}: "reviewed" must be true or false (true only after a second person signed off)`);
    checkSignOff(d, where, check);
    check(quiz.slug === (d.topic ?? '').split('/').filter(Boolean).pop(), `${where}: file name should match the topic slug`);

    const headingIds = new Set(page ? [...page.html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]) : []);
    const list = d.questions;
    if (!Array.isArray(list)) { problems.push(`${where}: "questions" must be a list`); continue; }
    check(list.length >= QUESTIONS_MIN && list.length <= QUESTIONS_MAX, `${where}: needs ${QUESTIONS_MIN} to ${QUESTIONS_MAX} questions (has ${list.length})`);

    list.forEach((q, i) => {
      const at = `${where} question ${i + 1}${q?.id ? ` (${q.id})` : ''}`;
      if (!q || typeof q !== 'object') { problems.push(`${at}: must be an object`); return; }

      check(typeof q.id === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(q.id), `${at}: id must be lowercase words joined by hyphens`);
      if (typeof q.id === 'string') {
        check(!seenIds.has(q.id), `${at}: id already used in ${seenIds.get(q.id)}`);
        seenIds.set(q.id, where);
      }
      check(typeof q.q === 'string' && q.q.trim().length >= 15, `${at}: the question text is missing or too short`);

      const choices = q.choices;
      const okChoices = Array.isArray(choices) && choices.length >= 3 && choices.length <= 5 && choices.every((c) => typeof c === 'string' && c.trim());
      check(okChoices, `${at}: needs 3 to 5 non-empty choices`);
      if (okChoices) {
        const norm = choices.map((c) => c.trim().toLowerCase());
        check(new Set(norm).size === norm.length, `${at}: two choices are identical`);
        check(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < choices.length, `${at}: "answer" must be the index (from 0) of exactly one choice`);
        // The longest, most qualified choice is a giveaway: a learner can pick it without knowing the topic.
        const right = choices[q.answer]?.trim().length ?? 0;
        const longestWrong = Math.max(...choices.filter((_, k) => k !== q.answer).map((c) => c.trim().length));
        check(right <= longestWrong * ANSWER_LENGTH_RATIO, `${at}: the right answer (${right} characters) is much longer than every wrong one (at most ${longestWrong}); make the wrong ones as specific`);
      }

      check(typeof q.why === 'string' && q.why.trim().length >= 20, `${at}: the explanation ("why") is missing or too short`);
      if (q.difficulty !== undefined) check([1, 2, 3].includes(q.difficulty), `${at}: difficulty must be 1, 2 or 3`);
      if (q.link !== undefined) {
        const ok = typeof q.link === 'string' && q.link.startsWith('#') && headingIds.has(q.link.slice(1));
        check(ok, `${at}: link "${q.link}" does not match any heading or section on ${d.topic}`);
      }
    });

    // A quiz where the answer is always in the same slot teaches the pattern, not the topic.
    const counts = {};
    for (const q of list) if (Number.isInteger(q?.answer)) counts[q.answer] = (counts[q.answer] ?? 0) + 1;
    const most = Math.max(0, ...Object.values(counts));
    check(list.length < QUESTIONS_MIN || most / list.length <= 0.6, `${where}: the correct answer is in the same position too often (${most} of ${list.length}); vary it`);

    // Likewise a quiz where the right answer is usually the longest choice.
    const longest = list.filter((q) => Array.isArray(q?.choices) && Number.isInteger(q.answer)
      && q.choices.every((c, k) => k === q.answer || String(c).trim().length < String(q.choices[q.answer]).trim().length)).length;
    check(list.length < QUESTIONS_MIN || longest / list.length <= LONGEST_ANSWER_SHARE, `${where}: the right answer is the longest choice in ${longest} of ${list.length} questions; at most ${Math.floor(list.length * LONGEST_ANSWER_SHARE)} may be`);
  }
  return problems;
}
