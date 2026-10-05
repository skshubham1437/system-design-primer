// A small Leitner-style spaced-repetition scheduler shared by flashcards and quizzes.
// Pure functions only: no clock access, no DOM, no storage. Every function takes `now`.
//
// Boxes: 0 = new or being relearned, 1..5 = increasingly well known.
// A card moves up one box each time you get it right and is next due after that box's interval.
// Getting it wrong sends it back to box 0 and it is shown again straight away.

export type Grade = 'again' | 'good' | 'easy';

export interface SrsItem {
  box: number;      // 0..5
  due: number;      // epoch ms; due when <= now
  seen: number;     // times graded
  lapses: number;   // times it was forgotten after being learned
}

/** Days until the next review once a card sits in box 1..5 (index 0 is unused). */
export const INTERVAL_DAYS = [0, 1, 3, 7, 21, 60] as const;
export const MAX_BOX = 5;
/** Boxes at or above this count as "mastered" in summaries. */
export const MASTERED_BOX = 4;

export const newItem = (now: number): SrsItem => ({ box: 0, due: now, seen: 0, lapses: 0 });

/** Local midnight at the start of the day containing `ts`. */
export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Add whole calendar days in local time. Unlike `ts + n * 86_400_000` this survives DST changes. */
export function addDays(ts: number, days: number): number {
  const d = new Date(ts);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** Apply a grade and return the updated item. The input is not modified. */
export function grade(item: SrsItem, g: Grade, now: number): SrsItem {
  const seen = item.seen + 1;
  if (g === 'again') {
    return { box: 0, due: now, seen, lapses: item.lapses + (item.box > 0 ? 1 : 0) };
  }
  const box = Math.min(MAX_BOX, item.box + (g === 'easy' ? 2 : 1));
  // Anchor to the start of today so "1 day" means tomorrow morning, however late tonight you studied.
  return { box, due: addDays(startOfDay(now), INTERVAL_DAYS[box]), seen, lapses: item.lapses };
}

export const isDue = (item: SrsItem, now: number): boolean => item.due <= now;

export interface Summary { total: number; new: number; due: number; learning: number; mastered: number }

/** Counts for a dashboard. `items` are the cards that have been seen; `total` is the deck size. */
export function summarize(items: SrsItem[], total: number, now: number): Summary {
  const seen = items.filter((i) => i.seen > 0);
  return {
    total,
    new: Math.max(0, total - seen.length),
    due: seen.filter((i) => isDue(i, now)).length,
    learning: seen.filter((i) => i.box < MASTERED_BOX).length,
    mastered: seen.filter((i) => i.box >= MASTERED_BOX).length,
  };
}

/** What the next intervals would be for each grade, for button hints ("Good: 3 days"). */
export function previewDays(item: SrsItem, now: number): Record<Grade, number> {
  const days = (g: Grade) => Math.round((startOfDay(grade(item, g, now).due) - startOfDay(now)) / 86_400_000);
  return { again: 0, good: days('good'), easy: days('easy') };
}
