import { describe, expect, it } from 'vitest';
import { emptyDoc, type ProgressDoc } from '../../src/lib/progress';
import { pickQuestions, scoreRun, seededShuffle, shuffleChoices, type Question, type TopicQuestion } from '../../src/lib/quiz';
import { nextUp, WEAK_BELOW, type NextUpInput } from '../../src/lib/next-up';
import { MIN_READ_MS, partialPct, requiredMs, shouldMarkRead } from '../../src/lib/reading';

const NOW = Date.UTC(2026, 5, 10, 12);
const DAY = 86_400_000;

const q = (id: string, answer = 1): Question => ({ id, q: `Question ${id}?`, choices: ['alpha', 'beta', 'gamma', 'delta'], answer, why: 'because', difficulty: 1 });
const tq = (id: string, topic: string): TopicQuestion => ({ ...q(id), topic });

describe('shuffling and scoring', () => {
  it('shuffles reproducibly for a seed and differently for another', () => {
    const list = Array.from({ length: 12 }, (_, i) => i);
    expect(seededShuffle(list, 'a')).toEqual(seededShuffle(list, 'a'));
    expect(seededShuffle(list, 'a')).not.toEqual(seededShuffle(list, 'b'));
    expect([...seededShuffle(list, 'a')].sort((x, y) => x - y)).toEqual(list);
  });

  it('keeps the answer pointing at the same text after shuffling choices', () => {
    for (const seed of ['1', '2', '3', '4', '5', '6']) {
      const shuffled = shuffleChoices(q('x', 2), seed);
      expect(shuffled.choices[shuffled.answer]).toBe('gamma');
      expect([...shuffled.choices].sort()).toEqual(['alpha', 'beta', 'delta', 'gamma']);
    }
  });

  it('does not change the original question', () => {
    const original = q('x', 2);
    shuffleChoices(original, 'seed');
    expect(original.choices).toEqual(['alpha', 'beta', 'gamma', 'delta']);
  });

  it('scores a run and lists the missed ids', () => {
    const qs = [q('a', 0), q('b', 1), q('c', 2)];
    expect(scoreRun(qs, [0, 3, 2])).toEqual({ correct: 2, of: 3, missed: ['b'] });
    expect(scoreRun(qs, [null, null, null])).toEqual({ correct: 0, of: 3, missed: ['a', 'b', 'c'] });
  });
});

describe('pickQuestions', () => {
  const pool = [tq('c1', 'cache'), tq('c2', 'cache'), tq('d1', 'db'), tq('d2', 'db'), tq('l1', 'lb'), tq('l2', 'lb')];
  const base = { questions: pool, readTopics: new Set<string>(), count: 4, now: NOW, seed: 's' };
  const item = (box: number, dueOffset: number) => ({ box, due: NOW + dueOffset, seen: 1, lapses: 0 });

  it('puts questions that are due for review first', () => {
    const picked = pickQuestions({ ...base, count: 2, items: { d2: item(0, -DAY), l1: item(1, -1) } });
    expect(picked.map((x) => x.id).sort()).toEqual(['d2', 'l1']);
  });

  it('prefers unseen questions from topics the learner has read', () => {
    const picked = pickQuestions({ ...base, count: 2, items: {}, readTopics: new Set(['lb']) });
    expect(picked.map((x) => x.id).sort()).toEqual(['l1', 'l2']);
  });

  it('falls back to other topics, then to the weakest already-seen questions', () => {
    const items = Object.fromEntries(pool.map((p, i) => [p.id, item(i % 5, 3 * DAY)]));
    const picked = pickQuestions({ ...base, count: 3, items });
    expect(picked).toHaveLength(3);
    // boxes are c1:0 c2:1 d1:2 d2:3 l1:4 l2:0, so the three lowest are c1, l2 and c2
    expect(picked.map((x) => x.id).sort()).toEqual(['c1', 'c2', 'l2']);
  });

  it('never returns more than exist or more than asked, and no duplicates', () => {
    const picked = pickQuestions({ ...base, count: 50, items: {} });
    expect(picked).toHaveLength(6);
    expect(new Set(picked.map((x) => x.id)).size).toBe(6);
  });

  it('is repeatable for a seed', () => {
    const a = pickQuestions({ ...base, items: {} });
    expect(pickQuestions({ ...base, items: {} })).toEqual(a);
  });
});

describe('reading rule', () => {
  it('needs both the end of the page and enough time', () => {
    expect(shouldMarkRead({ endSeen: true, visibleMs: 5 * 60_000, minutes: 5 })).toBe(true);
    expect(shouldMarkRead({ endSeen: false, visibleMs: 10 * 60_000, minutes: 5 })).toBe(false);
  });

  it('jumping to the bottom straight away does not count', () => {
    expect(shouldMarkRead({ endSeen: true, visibleMs: 2_000, minutes: 5 })).toBe(false);
  });

  it('requires 40% of the estimated reading time, with a floor for tiny pages', () => {
    expect(requiredMs(10)).toBe(4 * 60_000);
    expect(requiredMs(1)).toBe(0.4 * 60_000);
    expect(requiredMs(0)).toBeGreaterThanOrEqual(MIN_READ_MS);
    expect(MIN_READ_MS).toBeGreaterThan(0);
  });

  it('partial progress never reaches 100', () => {
    expect(partialPct(0.5)).toBe(50);
    expect(partialPct(1)).toBe(99);
    expect(partialPct(-1)).toBe(0);
  });
});

describe('nextUp', () => {
  const trail = [{ path: 'learn/a/', title: 'A' }, { path: 'learn/b/', title: 'B' }, { path: 'learn/c/', title: 'C' }];
  const solutions = [{ path: 'practice/system-design/x/', title: 'X' }, { path: 'practice/system-design/y/', title: 'Y' }];
  const quizTopics = [{ slug: 'b', topic: 'learn/b/', title: 'B', ids: ['b1', 'b2'] }, { slug: 'c', topic: 'learn/c/', title: 'C', ids: ['c1'] }];
  const make = (edit: (d: ProgressDoc) => void = () => {}): NextUpInput => { const doc = emptyDoc(); edit(doc); return { doc, now: NOW, trail, solutions, quizTopics }; };
  const readAll = (d: ProgressDoc) => { for (const t of trail) d.read[t.path] = { at: NOW, pct: 100 }; };

  it('starts a new learner at the first topic', () => {
    expect(nextUp(make())).toMatchObject({ kind: 'read', path: 'learn/a/', detail: 'A good place to start' });
  });

  it('moves along the trail past pages already read', () => {
    const n = nextUp(make((d) => { d.read['learn/a/'] = { at: NOW, pct: 100 }; }));
    expect(n).toMatchObject({ kind: 'read', path: 'learn/b/' });
  });

  it('does not count a half-read page as read', () => {
    expect(nextUp(make((d) => { d.read['learn/a/'] = { at: NOW, pct: 60 }; }))).toMatchObject({ path: 'learn/a/' });
  });

  it('due flashcards come before everything else', () => {
    const n = nextUp(make((d) => { d.cards.X = { box: 1, due: NOW - 1, seen: 2, lapses: 0 }; }));
    expect(n).toMatchObject({ kind: 'cards', detail: '1 card due' });
  });

  it('counts only due flashcards still in the deck, when the deck is known', () => {
    const edit = (d: ProgressDoc) => {
      d.cards.X = { box: 1, due: NOW - 1, seen: 2, lapses: 0 };
      d.cards.Removed = { box: 1, due: NOW - 1, seen: 2, lapses: 0 };
    };
    expect(nextUp({ ...make(edit), cardKeys: ['X', 'Y'] })).toMatchObject({ kind: 'cards', detail: '1 card due' });
    const onlyRemoved = make((d) => { d.cards.Removed = { box: 1, due: NOW - 1, seen: 2, lapses: 0 }; });
    expect(nextUp({ ...onlyRemoved, cardKeys: ['X'] }).kind).not.toBe('cards'); // cannot nag forever
    expect(nextUp(make(edit))).toMatchObject({ kind: 'cards', detail: '2 cards due' });
  });

  it('then due quiz questions, ignoring questions that no longer exist', () => {
    const stale = nextUp(make((d) => { d.quiz.items.gone = { box: 0, due: NOW - 1, seen: 1, lapses: 1 }; }));
    expect(stale.kind).toBe('read');
    const real = nextUp(make((d) => { d.quiz.items.b1 = { box: 0, due: NOW - 1, seen: 1, lapses: 1 }; }));
    expect(real).toMatchObject({ kind: 'quiz-review', path: 'quiz/' });
  });

  it('then the weakest quiz topic, using only the latest attempt', () => {
    const n = nextUp(make((d) => {
      d.quiz.attempts.push({ id: 'b', score: 1, of: 5, at: 1 }, { id: 'b', score: 5, of: 5, at: 2 }, { id: 'c', score: 2, of: 5, at: 3 });
    }));
    expect(n).toMatchObject({ kind: 'quiz-weak', path: 'learn/c/' }); // b recovered, c is weak
    expect(WEAK_BELOW).toBe(0.7);
  });

  it('a score at the threshold is not weak', () => {
    const n = nextUp(make((d) => { d.quiz.attempts.push({ id: 'b', score: 7, of: 10, at: 1 }); }));
    expect(n.kind).toBe('read');
  });

  it('after the trail, suggests an unfinished solution', () => {
    const n = nextUp(make((d) => { readAll(d); d.solutions['practice/system-design/x/'] = { status: 'done' }; }));
    expect(n).toMatchObject({ kind: 'solution', path: 'practice/system-design/y/' });
    const attempted = nextUp(make((d) => { readAll(d); d.solutions['practice/system-design/x/'] = { status: 'attempted' }; }));
    expect(attempted).toMatchObject({ path: 'practice/system-design/x/', detail: 'You started this one' });
  });

  it('reports done when everything is finished', () => {
    const n = nextUp(make((d) => { readAll(d); for (const s of solutions) d.solutions[s.path] = { status: 'done' }; }));
    expect(n.kind).toBe('done');
  });

  it('ignores read marks for pages that no longer exist', () => {
    const n = nextUp(make((d) => { d.read['learn/renamed-away/'] = { at: NOW, pct: 100 }; }));
    expect(n).toMatchObject({ kind: 'read', path: 'learn/a/' });
  });
});
