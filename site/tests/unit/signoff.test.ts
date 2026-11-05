import { describe, expect, it } from 'vitest';
import { checkSignOff } from '../../scripts/validate/signoff.mjs';
import { validateQuizzes } from '../../scripts/validate/quizzes.mjs';

const run = (d: Record<string, unknown>) => {
  const problems: string[] = [];
  checkSignOff(d, 'file.yaml', (ok: boolean, msg: string) => { if (!ok) problems.push(msg); });
  return problems;
};
const signed = { reviewed: true, author: 'Ana', reviewed_by: 'Ben', reviewed_on: '2026-11-06' };

describe('sign-off', () => {
  it('asks for nothing while content is still a draft', () => {
    expect(run({ reviewed: false })).toEqual([]);
    expect(run({})).toEqual([]);
  });

  it('accepts a review by someone other than the author, with a date', () => {
    expect(run(signed)).toEqual([]);
  });

  it('refuses reviewed: true without an author, a reviewer or a date', () => {
    expect(run({ ...signed, author: undefined }).join('\n')).toMatch(/"author" must name/);
    expect(run({ ...signed, reviewed_by: '' }).join('\n')).toMatch(/"reviewed_by" must name/);
    expect(run({ ...signed, reviewed_on: '6 Nov 2026' }).join('\n')).toMatch(/YYYY-MM-DD/);
  });

  it('refuses a review by the author, whatever the capitals', () => {
    expect(run({ ...signed, reviewed_by: 'ana' }).join('\n')).toMatch(/must not be the author/);
  });

  it('applies to quiz files through the quiz validator', () => {
    const pages = [{ path: 'learn/cache/', html: '<h3 id="cache-aside">x</h3>' }];
    const question = { id: 'q-signoff', q: 'Which component loads data after a miss?', choices: ['A', 'B', 'C'], answer: 1, why: 'The application loads the entry on a miss and adds it to the cache.' };
    const quiz = (over: Record<string, unknown>) => ({ slug: 'cache', file: 'cache.yaml', data: { topic: 'learn/cache/', questions: [question, { ...question, id: 'q-b', answer: 0 }, { ...question, id: 'q-c', answer: 2 }, { ...question, id: 'q-d', answer: 1 }, { ...question, id: 'q-e', answer: 0 }], ...over } });
    expect(validateQuizzes({ quizzes: [quiz({ reviewed: true })], pages }).join('\n')).toMatch(/"author" must name/);
    expect(validateQuizzes({ quizzes: [quiz({ reviewed: false })], pages }).join('\n')).not.toMatch(/author|reviewed_by/);
  });
});
