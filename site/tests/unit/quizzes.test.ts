import { describe, expect, it } from 'vitest';
import { validateQuizzes } from '../../scripts/validate/quizzes.mjs';

const pages = [{ path: 'learn/cache/', html: '<h3 id="cache-aside">x</h3><aside id="disadvantages-cache-aside"></aside>' }];

let n = 0;
const question = (over: Record<string, unknown> = {}) => ({
  id: `q-${++n}`,
  q: 'Which component loads the entry after a miss?',
  choices: ['The cache', 'The application', 'The database'],
  answer: 1,
  why: 'The application reads storage and fills the cache itself.',
  link: '#cache-aside',
  ...over,
});
const quiz = (questions: unknown[], over: Record<string, unknown> = {}, file = 'content/quizzes/cache.yaml') => ({
  slug: 'cache', file, data: { topic: 'learn/cache/', reviewed: false, questions, ...over },
});
// five questions with varied answer positions
const good = () => [0, 1, 2, 1, 0].map((answer) => question({ answer }));

describe('validateQuizzes', () => {
  it('accepts a well formed quiz', () => {
    expect(validateQuizzes({ quizzes: [quiz(good())], pages })).toEqual([]);
  });

  it('reports a file that does not parse', () => {
    const p = validateQuizzes({ quizzes: [{ slug: 'cache', file: 'f.yaml', data: null, error: 'bad indentation' }], pages });
    expect(p[0]).toMatch(/could not parse/);
  });

  it('rejects a topic that is not a page', () => {
    expect(validateQuizzes({ quizzes: [quiz(good(), { topic: 'learn/nope/' })], pages }).join('\n')).toMatch(/not a page/);
  });

  it('requires an explicit reviewed flag', () => {
    expect(validateQuizzes({ quizzes: [quiz(good(), { reviewed: 'yes' })], pages }).join('\n')).toMatch(/reviewed/);
  });

  it('requires 5 to 10 questions', () => {
    expect(validateQuizzes({ quizzes: [quiz(good().slice(0, 3))], pages }).join('\n')).toMatch(/5 to 10/);
    const eleven = Array.from({ length: 11 }, (_, i) => question({ answer: i % 3 }));
    expect(validateQuizzes({ quizzes: [quiz(eleven)], pages }).join('\n')).toMatch(/5 to 10/);
  });

  it('rejects bad ids and duplicate ids across files', () => {
    const bad = good(); bad[0].id = 'Not Valid';
    expect(validateQuizzes({ quizzes: [quiz(bad)], pages }).join('\n')).toMatch(/id must be/);
    const a = good(), b = good();
    b[0].id = a[0].id;
    const out = validateQuizzes({ quizzes: [quiz(a), quiz(b, {}, 'content/quizzes/other.yaml')], pages });
    expect(out.join('\n')).toMatch(/already used in content\/quizzes\/cache.yaml/);
  });

  it('requires 3 to 5 distinct choices', () => {
    const few = good(); few[0].choices = ['a', 'b'];
    expect(validateQuizzes({ quizzes: [quiz(few)], pages }).join('\n')).toMatch(/3 to 5/);
    const dup = good(); dup[0].choices = ['same', 'Same ', 'other'];
    expect(validateQuizzes({ quizzes: [quiz(dup)], pages }).join('\n')).toMatch(/identical/);
  });

  it('requires the answer to be a valid index', () => {
    for (const answer of [3, -1, 1.5, '1']) {
      const qs = good(); qs[0].answer = answer as number;
      expect(validateQuizzes({ quizzes: [quiz(qs)], pages }).join('\n')).toMatch(/answer/);
    }
  });

  it('requires an explanation', () => {
    const qs = good(); qs[0].why = 'Yes.';
    expect(validateQuizzes({ quizzes: [quiz(qs)], pages }).join('\n')).toMatch(/explanation/);
  });

  it('checks that the explanation link lands on a real section', () => {
    const qs = good(); qs[0].link = '#no-such-heading';
    expect(validateQuizzes({ quizzes: [quiz(qs)], pages }).join('\n')).toMatch(/does not match any heading/);
    const ok = good(); ok[0].link = '#disadvantages-cache-aside'; // ids on callouts count too
    expect(validateQuizzes({ quizzes: [quiz(ok)], pages })).toEqual([]);
  });

  it('allows a missing link (the whole page is then the reference)', () => {
    const qs = good(); delete (qs[0] as { link?: string }).link;
    expect(validateQuizzes({ quizzes: [quiz(qs)], pages })).toEqual([]);
  });

  it('flags a quiz whose answers sit in the same slot', () => {
    const same = [1, 1, 1, 1, 0].map((answer) => question({ answer }));
    expect(validateQuizzes({ quizzes: [quiz(same)], pages }).join('\n')).toMatch(/same position/);
  });

  it('restricts difficulty to 1, 2 or 3', () => {
    const qs: Record<string, unknown>[] = good(); qs[0].difficulty = 5;
    expect(validateQuizzes({ quizzes: [quiz(qs)], pages }).join('\n')).toMatch(/difficulty/);
  });
});
