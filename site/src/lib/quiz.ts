// Quiz mechanics: seeded shuffling, scoring and picking questions for a mixed quiz. Pure functions.
import { hash32, mulberry32 } from './sim';
import { isDue, type SrsItem } from './srs';

export interface Question {
  id: string;
  q: string;
  choices: string[];
  answer: number;
  why: string;
  link?: string;
  difficulty: number;
}
export interface TopicQuestion extends Question { topic: string }

/** Shuffle a list with a seed so the same run always produces the same order. */
export function seededShuffle<T>(list: T[], seed: string): T[] {
  const rand = mulberry32(hash32(seed));
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Shuffle the choices of one question, keeping `answer` pointing at the same text. */
export function shuffleChoices(q: Question, seed: string): Question {
  const order = seededShuffle(q.choices.map((_, i) => i), `${seed}:${q.id}`);
  return { ...q, choices: order.map((i) => q.choices[i]), answer: order.indexOf(q.answer) };
}

export interface RunScore { correct: number; of: number; missed: string[] }

/** `picked[i]` is the chosen choice index for question i, or null if unanswered. */
export function scoreRun(questions: Question[], picked: (number | null)[]): RunScore {
  const missed: string[] = [];
  let correct = 0;
  questions.forEach((q, i) => { if (picked[i] === q.answer) correct++; else missed.push(q.id); });
  return { correct, of: questions.length, missed };
}

/**
 * Choose questions for a mixed quiz.
 *  1. questions that are due for review (missed before, or scheduled)
 *  2. questions never seen, from topics the learner has read
 *  3. questions never seen, from other topics
 *  4. everything else, weakest box first
 * The result is shuffled so topics interleave.
 */
export function pickQuestions(o: {
  questions: TopicQuestion[];
  items: Record<string, SrsItem>;
  readTopics: Set<string>;
  count: number;
  now: number;
  seed: string;
}): TopicQuestion[] {
  const { questions, items, readTopics, count, now, seed } = o;
  const seen = (q: TopicQuestion) => (items[q.id]?.seen ?? 0) > 0;
  const due = questions.filter((q) => seen(q) && isDue(items[q.id], now)).sort((a, b) => items[a.id].due - items[b.id].due);
  const fresh = questions.filter((q) => !seen(q));
  const freshRead = seededShuffle(fresh.filter((q) => readTopics.has(q.topic)), `${seed}:fr`);
  const freshOther = seededShuffle(fresh.filter((q) => !readTopics.has(q.topic)), `${seed}:fo`);
  const rest = questions.filter((q) => seen(q) && !isDue(items[q.id], now)).sort((a, b) => items[a.id].box - items[b.id].box);
  const chosen: TopicQuestion[] = [];
  for (const q of [...due, ...freshRead, ...freshOther, ...rest]) { if (chosen.length >= count) break; chosen.push(q); }
  return seededShuffle(chosen, `${seed}:final`);
}
