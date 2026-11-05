import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, grade, INTERVAL_DAYS, isDue, newItem, previewDays, startOfDay, summarize } from '../../src/lib/srs';

// Use a zone with daylight saving so the date maths is actually exercised.
beforeAll(() => { process.env.TZ = 'America/New_York'; });

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const dayOf = (ts: number) => new Date(ts).getDate();

describe('progression', () => {
  it('a card answered correctly returns after 1, then 3, then 7, then 21 days', () => {
    const t0 = at(2026, 6, 1);
    let item = newItem(t0);
    const dueDays: number[] = [];
    let now = t0;
    for (let i = 0; i < 4; i++) {
      item = grade(item, 'good', now);
      dueDays.push(Math.round((startOfDay(item.due) - startOfDay(now)) / 86_400_000));
      now = item.due + 3_600_000; // review one hour after it falls due
    }
    expect(dueDays).toEqual([1, 3, 7, 21]);
  });

  it('is due tomorrow morning even when studied late at night', () => {
    const item = grade(newItem(at(2026, 6, 1, 23)), 'good', at(2026, 6, 1, 23));
    expect(isDue(item, at(2026, 6, 1, 23, ))).toBe(false);
    expect(isDue(item, at(2026, 6, 2, 0) + 1)).toBe(true);
  });

  it('Again sends a learned card back to box 0, counts a lapse and makes it due immediately', () => {
    const now = at(2026, 6, 1);
    const learned = { box: 3, due: now + 1, seen: 5, lapses: 0 };
    const out = grade(learned, 'again', now);
    expect(out).toEqual({ box: 0, due: now, seen: 6, lapses: 1 });
    expect(isDue(out, now)).toBe(true);
  });

  it('Again on a brand new card is not a lapse', () => {
    const now = at(2026, 6, 1);
    expect(grade(newItem(now), 'again', now).lapses).toBe(0);
  });

  it('Easy skips a box, and the top box is capped', () => {
    const now = at(2026, 6, 1);
    expect(grade(newItem(now), 'easy', now).box).toBe(2);
    expect(grade({ box: 5, due: now, seen: 9, lapses: 0 }, 'good', now).box).toBe(5);
    expect(grade({ box: 4, due: now, seen: 9, lapses: 0 }, 'easy', now).box).toBe(5);
  });

  it('does not modify its input', () => {
    const item = newItem(at(2026, 6, 1));
    const copy = { ...item };
    grade(item, 'good', at(2026, 6, 1));
    expect(item).toEqual(copy);
  });

  it('an overdue card is simply due, with no penalty to its box', () => {
    const item = { box: 3, due: at(2026, 6, 1), seen: 4, lapses: 0 };
    const weekLater = at(2026, 6, 20);
    expect(isDue(item, weekLater)).toBe(true);
    expect(grade(item, 'good', weekLater).box).toBe(4);
  });

  it('uses the documented intervals', () => {
    expect(INTERVAL_DAYS.slice(1)).toEqual([1, 3, 7, 21, 60]);
  });
});

describe('calendar maths', () => {
  it('addDays keeps local midnight across the spring DST change (a 23 hour day)', () => {
    const before = at(2026, 3, 7, 0); // US clocks go forward on 8 March 2026
    const later = addDays(before, 2);
    expect(dayOf(later)).toBe(9);
    expect(new Date(later).getHours()).toBe(0);
  });

  it('addDays keeps local midnight across the autumn DST change (a 25 hour day)', () => {
    const before = at(2026, 10, 31, 0); // clocks go back on 1 November 2026
    const later = addDays(before, 2);
    expect(dayOf(later)).toBe(2);
    expect(new Date(later).getHours()).toBe(0);
  });

  it('a card graded the day before DST starts is still due the next calendar day', () => {
    const now = at(2026, 3, 7, 20);
    const item = grade(newItem(now), 'good', now);
    expect(dayOf(item.due)).toBe(8);
    expect(new Date(item.due).getHours()).toBe(0);
  });

  it('startOfDay is local midnight', () => {
    const d = new Date(startOfDay(at(2026, 6, 1, 17)));
    expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([0, 0, 0]);
  });
});

describe('summaries', () => {
  const now = at(2026, 6, 10);
  const mk = (box: number, dueOffsetDays: number, seen = 1) => ({ box, due: addDays(now, dueOffsetDays), seen, lapses: 0 });

  it('counts new, due, learning and mastered cards', () => {
    const items = [mk(1, -1), mk(2, 3), mk(4, 5), mk(5, -2)];
    expect(summarize(items, 10, now)).toEqual({ total: 10, new: 6, due: 2, learning: 2, mastered: 2 });
  });

  it('ignores cards that were never graded', () => {
    expect(summarize([{ box: 0, due: now, seen: 0, lapses: 0 }], 3, now)).toMatchObject({ new: 3, due: 0 });
  });

  it('previews the next interval for each button', () => {
    const p = previewDays({ box: 1, due: now, seen: 1, lapses: 0 }, now);
    expect(p).toEqual({ again: 0, good: 3, easy: 7 });
  });
});
