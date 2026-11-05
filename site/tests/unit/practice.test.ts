import { describe, expect, it } from 'vitest';
import { validatePractice } from '../../scripts/validate/practice.mjs';

const html = (ids: string[]) => ids.map((id) => `<section class="sol-step" data-step="${id}"><h2 id="${id}">x</h2></section>`).join('');
const pages = [{ path: 'practice/system-design/x/', kind: 'solution', html: html(['step-1-a', 'step-2-b', 'additional-talking-points']) }];

const step = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  prompt: 'Describe how you would approach this step in detail.',
  rubric: ['I covered the first thing', 'I covered the second thing', 'I covered the third thing'],
  ...over,
});
const followups = () => [1, 2, 3].map((n) => ({ q: `Follow-up question number ${n}?`, a: 'A reasoned answer that is comfortably longer than forty characters in total.' }));
const file = (over: Record<string, unknown> = {}) => ({
  slug: 'x', file: 'content/practice/x.yaml',
  data: { solution: 'practice/system-design/x/', reviewed: false, steps: [step('step-1-a'), step('step-2-b')], followups: followups(), ...over },
});

describe('validatePractice', () => {
  it('accepts a complete practice set', () => {
    expect(validatePractice({ practice: [file()], pages })).toEqual([]);
  });

  it('reports parse errors and empty files', () => {
    expect(validatePractice({ practice: [{ slug: 'x', file: 'f.yaml', data: null, error: 'bad' }], pages })[0]).toMatch(/could not parse/);
    expect(validatePractice({ practice: [{ slug: 'x', file: 'f.yaml', data: null }], pages })[0]).toMatch(/empty/);
  });

  it('requires a real solution page and an explicit reviewed flag', () => {
    expect(validatePractice({ practice: [file({ solution: 'learn/cache/' })], pages }).join('\n')).toMatch(/not a solution page/);
    expect(validatePractice({ practice: [file({ reviewed: 'no' })], pages }).join('\n')).toMatch(/reviewed/);
  });

  it('every step id must match a heading on the page', () => {
    const out = validatePractice({ practice: [file({ steps: [step('step-1-a'), step('step-9-nope')] })], pages }).join('\n');
    expect(out).toMatch(/must match a step heading/);
  });

  it('every step on the page must be covered, so a new step cannot be silently skipped', () => {
    const out = validatePractice({ practice: [file({ steps: [step('step-1-a')] })], pages }).join('\n');
    expect(out).toMatch(/"step-2-b" but the practice file does not cover it/);
  });

  it('steps that are not numbered (the talking points section) are optional', () => {
    expect(validatePractice({ practice: [file()], pages })).toEqual([]);
  });

  it('rejects the same step twice', () => {
    expect(validatePractice({ practice: [file({ steps: [step('step-1-a'), step('step-1-a'), step('step-2-b')] })], pages }).join('\n')).toMatch(/listed twice/);
  });

  it('needs a meaningful prompt and 3 to 7 distinct rubric items', () => {
    expect(validatePractice({ practice: [file({ steps: [step('step-1-a', { prompt: 'Short' }), step('step-2-b')] })], pages }).join('\n')).toMatch(/prompt/);
    expect(validatePractice({ practice: [file({ steps: [step('step-1-a', { rubric: ['one item that is long enough', 'two item that is long enough'] }), step('step-2-b')] })], pages }).join('\n')).toMatch(/3 to 7 rubric/);
    expect(validatePractice({ practice: [file({ steps: [step('step-1-a', { rubric: ['Same thing here ok', 'same thing here ok', 'a third different one'] }), step('step-2-b')] })], pages }).join('\n')).toMatch(/duplicate rubric/);
  });

  it('needs 3 to 8 follow-ups with real answers', () => {
    expect(validatePractice({ practice: [file({ followups: followups().slice(0, 2) })], pages }).join('\n')).toMatch(/3 to 8 follow-up/);
    const bad = followups(); bad[0].a = 'Too short.';
    expect(validatePractice({ practice: [file({ followups: bad })], pages }).join('\n')).toMatch(/answer is missing or too short/);
  });
});
