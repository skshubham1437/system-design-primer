// "What should I do next?" Deterministic so it can be tested and explained.
import type { ProgressDoc } from './progress';
import { isDue } from './srs';

export interface NextUpInput {
  doc: ProgressDoc;
  now: number;
  /** Topic pages in reading order. */
  trail: { path: string; title: string }[];
  solutions: { path: string; title: string }[];
  /** One entry per quiz: its topic page, a title, and its question ids. */
  quizTopics: { slug: string; topic: string; title: string; ids: string[] }[];
  /** The cards in the current deck. Without it, every due card in the document counts. */
  cardKeys?: string[];
}

export type NextUp =
  | { kind: 'cards'; path: string; title: string; detail: string }
  | { kind: 'quiz-review'; path: string; title: string; detail: string }
  | { kind: 'quiz-weak'; path: string; title: string; detail: string }
  | { kind: 'read'; path: string; title: string; detail: string }
  | { kind: 'solution'; path: string; title: string; detail: string }
  | { kind: 'done'; path: string; title: string; detail: string };

/** A quiz topic below this score on the latest attempt counts as weak. */
export const WEAK_BELOW = 0.7;

export const isRead = (doc: ProgressDoc, path: string) => (doc.read[path]?.pct ?? 0) >= 100;

export function lastAttempts(doc: ProgressDoc): Map<string, { score: number; of: number; at: number }> {
  const out = new Map<string, { score: number; of: number; at: number }>();
  for (const a of doc.quiz.attempts) { const prev = out.get(a.id); if (!prev || a.at >= prev.at) out.set(a.id, a); }
  return out;
}

export function nextUp({ doc, now, trail, solutions, quizTopics, cardKeys }: NextUpInput): NextUp {
  // only count cards that still exist, so a removed card cannot nag forever
  const deck = cardKeys && new Set(cardKeys);
  const dueCards = Object.entries(doc.cards).filter(([key, c]) => (!deck || deck.has(key)) && c.seen > 0 && isDue(c, now)).length;
  if (dueCards > 0) return { kind: 'cards', path: 'practice/flashcards/', title: 'Review your flashcards', detail: `${dueCards} card${dueCards === 1 ? '' : 's'} due` };

  // only count questions that still exist, so a removed question cannot nag forever
  const known = new Set(quizTopics.flatMap((t) => t.ids));
  const dueQuiz = Object.entries(doc.quiz.items).filter(([id, i]) => known.has(id) && i.seen > 0 && isDue(i, now)).length;
  if (dueQuiz > 0) return { kind: 'quiz-review', path: 'quiz/', title: 'Review quiz questions you missed', detail: `${dueQuiz} question${dueQuiz === 1 ? '' : 's'} due` };

  const last = lastAttempts(doc);
  const weak = quizTopics
    .map((t) => ({ t, a: last.get(t.slug) }))
    .filter((x): x is { t: (typeof quizTopics)[number]; a: { score: number; of: number; at: number } } => !!x.a && x.a.of > 0 && x.a.score / x.a.of < WEAK_BELOW)
    .sort((x, y) => x.a.score / x.a.of - y.a.score / y.a.of)[0];
  if (weak) return { kind: 'quiz-weak', path: weak.t.topic, title: `Revisit ${weak.t.title}`, detail: `You scored ${weak.a.score} of ${weak.a.of} last time` };

  const unread = trail.find((p) => !isRead(doc, p.path));
  if (unread) return { kind: 'read', path: unread.path, title: unread.title, detail: Object.keys(doc.read).length ? 'Next topic in the reading order' : 'A good place to start' };

  const sol = solutions.find((s) => doc.solutions[s.path]?.status !== 'done');
  if (sol) return { kind: 'solution', path: sol.path, title: sol.title, detail: doc.solutions[sol.path]?.status === 'attempted' ? 'You started this one' : 'Try a worked solution' };

  return { kind: 'done', path: 'labs/', title: 'You have covered everything', detail: 'Explore the labs, or retake a quiz to keep it fresh' };
}
