import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';

const KEY = 'primer:v1';
const DAY = 86_400_000;
// The deck size comes from the build (upstream cards plus the site's own), so tests read it instead of hard-coding it.
const DECK = (JSON.parse(fs.readFileSync(new URL('../../src/generated/flashcards.json', import.meta.url), 'utf8')) as unknown[]).length;

/** Put data in localStorage before the page's own scripts run, but only the first time (not on reload). */
async function seed(page: Page, values: Record<string, unknown>) {
  await page.addInitScript((v) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    for (const [k, val] of Object.entries(v)) localStorage.setItem(k, typeof val === 'string' ? val : JSON.stringify(val));
  }, values);
}

/** The store writes ~150ms after a change (and on page hide); poll instead of racing it. */
const doc = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);

const stat = (page: Page, label: string) => page.locator('.fc-stats > div', { hasText: label }).locator('dd');

test.describe('spaced flashcards', () => {
  test('grading a new card moves it out of New, saves it, and schedules it for tomorrow', async ({ page }) => {
    await page.goto('practice/flashcards/');
    await expect(stat(page, 'New')).toHaveText(String(DECK));
    await expect(stat(page, 'Due')).toHaveText('0');

    await page.getByRole('button', { name: /Show answer/ }).click();
    await page.keyboard.press('2'); // Good
    await expect(stat(page, 'New')).toHaveText(String(DECK - 1));
    await expect(stat(page, 'Learning')).toHaveText('1');

    await expect.poll(async () => Object.keys((await doc(page))?.cards ?? {}).length).toBe(1);
    const [card] = Object.values((await doc(page)).cards) as { box: number; due: number }[];
    expect(card.box).toBe(1);
    expect(card.due).toBeGreaterThan(Date.now());
    expect(card.due).toBeLessThan(Date.now() + 2 * DAY);

    await page.reload();
    await expect(stat(page, 'New')).toHaveText(String(DECK - 1));
    await expect(stat(page, 'Due')).toHaveText('0');
  });

  test('Again keeps the card in this session and records no day delay', async ({ page }) => {
    await page.goto('practice/flashcards/');
    const first = await page.locator('.fc-front').textContent();
    await page.getByRole('button', { name: /Show answer/ }).click();
    await page.keyboard.press('1'); // Again
    await expect(page.locator('.fc-front')).not.toHaveText(first!);
    await expect.poll(async () => (await doc(page))?.cards?.[first!]?.box).toBe(0);
    expect((await doc(page)).cards[first!].due).toBeLessThanOrEqual(Date.now());
  });

  test('the daily limit caps how many new cards appear', async ({ page }) => {
    await seed(page, { [KEY]: { version: 1, settings: { newCardsPerDay: 5 } } });
    await page.goto('practice/flashcards/');
    await expect(page.locator('.fc-count')).toContainText('5 left');
  });

  test('cards that were due before the page loaded are offered first, and the nav badge counts them', async ({ page }) => {
    const past = Date.now() - 3 * DAY;
    await seed(page, { [KEY]: { version: 1, cards: { 'Cache-aside': { box: 2, due: past, seen: 3, lapses: 0 }, Sharding: { box: 1, due: past, seen: 1, lapses: 0 } } } });
    await page.goto('learn/cache/'); // badge lives in the sidebar on every page (desktop)
    if (!(await page.locator('#sidebar').isVisible())) await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.locator('[data-due-badge]')).toHaveText('2');
    await page.goto('practice/flashcards/');
    await expect(stat(page, 'Due')).toHaveText('2');
  });

  test('browsing all cards does not change the schedule', async ({ page }) => {
    await page.goto('practice/flashcards/');
    await page.getByRole('button', { name: 'Browse all' }).click();
    await page.getByRole('button', { name: /Show answer/ }).click();
    await page.getByRole('button', { name: 'Next card' }).click();
    await page.waitForTimeout(400); // longer than the write debounce
    expect(Object.keys((await doc(page))?.cards ?? {})).toHaveLength(0);
  });
});

test.describe('migration from the old storage keys', () => {
  test('previously known cards and planner ticks survive', async ({ page }) => {
    await seed(page, {
      'primer:cards:v1': { known: ['Cache-aside', 'Sharding'] },
      'primer:plan:v1': { last: 'short', done: { short: [0, 1] } },
    });
    await page.goto('practice/flashcards/');
    await expect(stat(page, 'Learning')).toHaveText('2'); // box 3 is learning, not yet mastered
    await expect(stat(page, 'New')).toHaveText(String(DECK - 2));

    await page.goto('interview/study-guide/#short');
    await expect(page.locator('.plan-foot span').first()).toContainText('2 of');

    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys).toContain(KEY);
    expect(keys).not.toContain('primer:cards:v1');
    expect(keys).not.toContain('primer:plan:v1');
  });
});

test.describe('your data panel', () => {
  test('exports a valid file, and an import restores it after a reset', async ({ page }, info) => {
    await page.goto('practice/flashcards/');
    await page.getByRole('button', { name: /Show answer/ }).click();
    await page.keyboard.press('2');

    await page.goto('about/');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export progress' }).click()]);
    const file = info.outputPath('progress.json');
    await download.saveAs(file);
    const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(exported.version).toBe(1);
    expect(Object.keys(exported.cards)).toHaveLength(1);

    // two-step reset: the first click only arms the button
    await page.getByText('Reset', { exact: true }).click();
    const resetAll = page.getByRole('button', { name: /Reset everything/ });
    await resetAll.click();
    await expect(page.getByRole('button', { name: 'Click again to confirm' })).toBeVisible();
    expect(Object.keys(await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{"cards":{}}').cards, KEY))).toHaveLength(1);
    await page.getByRole('button', { name: 'Click again to confirm' }).click();
    await expect(page.locator('.dp-msg')).toHaveText('Reset.');
    expect(Object.keys(await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{"cards":{}}').cards, KEY))).toHaveLength(0);

    await page.locator('input[data-act="import"]').setInputFiles(file);
    await expect(page.locator('.dp-msg')).toContainText('Imported');
    await expect.poll(async () => Object.keys((await doc(page))?.cards ?? {}).length).toBe(1);
  });

  test('a bad file is rejected and nothing changes', async ({ page }, info) => {
    await seed(page, { [KEY]: { version: 1, plan: { last: 'long', done: {} } } });
    await page.goto('about/');
    const bad = info.outputPath('bad.json');
    fs.writeFileSync(bad, '{"hello": "world"}');
    await page.locator('input[data-act="import"]').setInputFiles(bad);
    await expect(page.locator('.dp-msg')).toContainText('does not look like');
    await page.waitForTimeout(400);
    expect((await doc(page)).plan.last).toBe('long');
  });
});

const pages = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`learn/page-${i}/`, { at: 1, pct: 100 }]));

/** Make the browser refuse writes to the progress document, the way a full localStorage does. */
const breakWrites = (page: Page) => page.evaluate((k) => {
  const proto = Storage.prototype as unknown as Record<string, unknown> & { setItem: (key: string, value: string) => void };
  const real = proto.setItem;
  proto.realSetItem = real;
  proto.setItem = function (this: Storage, key: string, value: string) {
    if (key === k) throw new DOMException('full', 'QuotaExceededError');
    real.call(this, key, value);
  };
}, KEY);
const fixWrites = (page: Page) => page.evaluate(() => {
  const proto = Storage.prototype as unknown as { setItem: unknown; realSetItem: unknown };
  proto.setItem = proto.realSetItem;
});

async function expectAccessible(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${label}: ${v.id} ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
}

test.describe('keeping a copy of your progress', () => {
  test('with plenty unexported, the progress page and flashcards say so calmly, and exporting clears it', async ({ page }, info) => {
    await seed(page, { [KEY]: { version: 1, read: pages(12) } });
    await page.goto('progress/');
    const note = page.locator('.backup-note');
    await expect(note).toContainText('You have not exported it yet');
    await expect(note).toContainText('Browsers can clear this data');
    await expect(page.locator('main [role="alert"]')).toHaveCount(0); // a reminder, not an alarm
    await expectAccessible(page, 'progress reminder');

    await page.goto('practice/flashcards/');
    await expect(page.locator('.backup-note')).toContainText('Keep a copy of your progress');

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export now' }).click()]);
    const file = info.outputPath('progress.json');
    await download.saveAs(file);
    await expect(page.locator('.backup-note')).toBeHidden();

    const saved = await doc(page);
    expect(saved.backup.exportedAt).toBeGreaterThan(Date.now() - DAY);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).backup.exportedAt).toBe(saved.backup.exportedAt); // the file knows its own date

    await page.reload();
    await expect(stat(page, 'Due')).toBeVisible();
    await expect(page.locator('.backup-note')).toBeHidden();
  });

  test('comes back when an old export has fallen behind, and stays away for a recent one', async ({ page }) => {
    const old = Date.now() - 8 * DAY;
    await seed(page, { [KEY]: { version: 1, read: pages(12), backup: { exportedAt: old, changedAt: old + 1 } } });
    await page.goto('progress/');
    await expect(page.locator('.backup-note')).toContainText('You last exported it on');

    await page.evaluate(([k, at]) => {
      const d = JSON.parse(localStorage.getItem(k as string)!);
      d.backup = { exportedAt: at, changedAt: at };
      localStorage.setItem(k as string, JSON.stringify(d));
    }, [KEY, Date.now() - DAY]);
    await page.reload();
    await expect(page.locator('.prog-next')).toBeVisible();
    await expect(page.locator('.backup-note')).toBeHidden();
  });

  test('says nothing to a learner with little to lose', async ({ page }) => {
    await seed(page, { [KEY]: { version: 1, read: pages(3) } });
    await page.goto('progress/');
    await expect(page.locator('.prog-next')).toBeVisible();
    await expect(page.locator('.backup-note')).toBeHidden();
  });

  test('the progress page has export itself, and says plainly that browsers can clear the data', async ({ page }) => {
    await seed(page, { [KEY]: { version: 1, read: pages(3) } });
    await page.goto('progress/');
    const panel = page.locator('.data-panel');
    await expect(panel).toContainText('Browsers can clear this data');
    await expect(panel).toContainText('Not exported yet');
    const [download] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Export progress' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^primer-progress-.*\.json$/);
    await expect(panel).toContainText('Last exported on');
  });

  test('asks the browser to keep the data on the first save only, and copes with a refusal', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { persistCalls: number };
      w.persistCalls = 0;
      navigator.storage.persist = () => { w.persistCalls++; return Promise.resolve(false); };
    });
    const calls = () => page.evaluate(() => (window as unknown as { persistCalls: number }).persistCalls);
    const gradeOne = async () => {
      await page.getByRole('button', { name: /Show answer/ }).click();
      await page.keyboard.press('2');
    };

    await page.goto('practice/flashcards/');
    await expect(page.locator('.fc-front')).toBeVisible();
    expect(await calls()).toBe(0); // just visiting is not saving

    await gradeOne();
    await expect.poll(calls).toBe(1);
    await gradeOne();
    expect(await calls()).toBe(1);

    await expect.poll(async () => Object.keys((await doc(page))?.cards ?? {}).length).toBe(2);
    await page.reload();
    await gradeOne();
    await expect.poll(async () => Object.keys((await doc(page))?.cards ?? {}).length).toBe(3);
    expect(await calls()).toBe(0); // a new page, and the browser has already been asked
    await expect(page.locator('.save-warn')).toHaveCount(0);
  });
});

test.describe('importing over existing progress', () => {
  const incoming = { version: 1, cards: { A: { box: 1, due: 5, seen: 1, lapses: 0 }, B: { box: 1, due: 5, seen: 1, lapses: 0 }, C: { box: 1, due: 5, seen: 1, lapses: 0 } } };
  const here = { version: 1, plan: { last: 'long', done: {} }, read: pages(2), cards: { Mine: { box: 2, due: 5, seen: 2, lapses: 0 } } };

  test('shows what would be replaced, and replaces nothing until you say so', async ({ page }, info) => {
    await seed(page, { [KEY]: here });
    await page.goto('about/');
    const file = info.outputPath('in.json');
    fs.writeFileSync(file, JSON.stringify(incoming));

    await page.locator('input[data-act="import"]').setInputFiles(file);
    const box = page.locator('.dp-confirm');
    await expect(box).toContainText('Replace your progress with this file?');
    await expect(box.locator('tr', { hasText: 'Cards studied' }).locator('td')).toHaveText(['1', '3']);
    await expect(box.locator('tr', { hasText: 'Pages read' }).locator('td')).toHaveText(['2', '0']);
    await expect(page.getByRole('button', { name: 'Keep what I have' })).toBeFocused();
    await expectAccessible(page, 'import confirmation');

    await page.waitForTimeout(400);
    expect((await doc(page)).cards.Mine).toBeDefined();

    await page.getByRole('button', { name: 'Keep what I have' }).click();
    await expect(box).toBeHidden();
    await expect(page.locator('.dp-msg')).toHaveText('Nothing was imported.');
    expect((await doc(page)).cards.Mine).toBeDefined();

    await page.locator('input[data-act="import"]').setInputFiles(file); // the same file again
    await page.getByRole('button', { name: 'Replace my progress' }).click();
    await expect(page.locator('.dp-msg')).toContainText('Imported');
    await expect.poll(async () => Object.keys((await doc(page))?.cards ?? {}).sort()).toEqual(['A', 'B', 'C']);

    await page.getByRole('button', { name: 'Undo last import' }).click();
    await expect.poll(async () => Object.keys((await doc(page))?.cards ?? {})).toEqual(['Mine']);
  });

  test('does not say Imported when the write fails', async ({ page }, info) => {
    await seed(page, { [KEY]: here });
    await page.goto('about/');
    const file = info.outputPath('in.json');
    fs.writeFileSync(file, JSON.stringify(incoming));
    await page.locator('input[data-act="import"]').setInputFiles(file);
    await breakWrites(page);
    await page.getByRole('button', { name: 'Replace my progress' }).click();

    await expect(page.locator('.dp-msg')).toContainText('would not save the import');
    await expect(page.locator('.dp-msg')).not.toContainText('Imported');
    await expect(page.locator('.data-panel .fc-stats > div', { hasText: 'Cards studied' }).locator('dd')).toHaveText('1');
    expect((await doc(page)).cards.Mine).toBeDefined();
    expect(await page.evaluate((k) => localStorage.getItem(`${k}:backup`), KEY)).toBeNull();
  });
});

test.describe('when saving fails', () => {
  const warning = (page: Page) => page.locator('.save-warn');

  test('a quiz shows the warning', async ({ page }) => {
    await page.goto('learn/cache/');
    const quiz = page.locator('.widget.quiz');
    await quiz.getByRole('button', { name: 'Start the quiz' }).click();
    await breakWrites(page);
    for (let i = 0; i < 6; i++) {
      await quiz.locator('.quiz-choice').first().click();
      await quiz.getByRole('button', { name: /Next question|See results/ }).click();
    }
    await expect(quiz.locator('.quiz-score')).toBeVisible();
    await expect(warning(page)).toContainText('has not been saved');
  });

  test('practice notes show the warning', async ({ page }) => {
    await page.goto('practice/system-design/pastebin/');
    await page.getByRole('button', { name: /Try it first/ }).click();
    await breakWrites(page);
    await page.locator('#pp-notes').fill('About 4 writes/s.');
    await expect(warning(page)).toContainText('has not been saved');
  });

  test('an exercise shows the warning, and the next change saves everything and clears it', async ({ page }) => {
    await page.goto('databases/btree-indexes/');
    const x = page.locator('.sqlx').first();
    await expect(x.getByRole('button', { name: /Show a hint/ })).toBeVisible();
    await breakWrites(page);
    await x.getByRole('button', { name: /Show a hint/ }).click();
    await expect(warning(page)).toContainText('will try again on your next change');
    await expectAccessible(page, 'not-saved warning');

    await fixWrites(page);
    await x.getByRole('button', { name: /Next hint/ }).click();
    await expect(warning(page)).toBeHidden();
    const saved = await doc(page);
    expect((Object.values(saved.exercises)[0] as { hints: number }).hints).toBe(2);
  });

  test('the warning can be dismissed, and offers an export that holds the unsaved work', async ({ page }, info) => {
    await page.goto('practice/flashcards/');
    await breakWrites(page);
    await page.getByRole('button', { name: /Show answer/ }).click();
    await page.keyboard.press('2');
    await expect(warning(page)).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), warning(page).getByRole('button', { name: 'Export a copy' }).click()]);
    const file = info.outputPath('rescue.json');
    await download.saveAs(file);
    expect(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).cards)).toHaveLength(1);
    await warning(page).getByRole('button', { name: 'Dismiss' }).click();
    await expect(warning(page)).toBeHidden();
  });

  test('no warning while saving works', async ({ page }) => {
    await page.goto('practice/flashcards/');
    await page.getByRole('button', { name: /Show answer/ }).click();
    await page.keyboard.press('2');
    await expect.poll(async () => Object.keys((await doc(page))?.cards ?? {}).length).toBe(1);
    await expect(warning(page)).toHaveCount(0);
  });

  test('a document from a newer version stays untouched and the tab says why', async ({ page }) => {
    const newer = JSON.stringify({ version: 99, cards: {}, future: { x: 1 } });
    await seed(page, { [KEY]: newer });
    await page.goto('practice/flashcards/');
    await page.getByRole('button', { name: /Show answer/ }).click();
    await page.keyboard.press('2');
    await expect(warning(page)).toContainText('newer version');
    await page.waitForTimeout(400);
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe(newer);
  });
});

test.describe('sharing storage with other tabs and other versions', () => {
  test('a change waiting to be saved survives another tab saving first', async ({ page, context }) => {
    await page.clock.install();
    await page.goto('practice/flashcards/');
    await expect(page.locator('.fc-front')).toBeVisible();
    await page.clock.pauseAt(Date.now() + 60_000); // the 150ms save delay cannot run out by itself now

    await page.getByRole('button', { name: /Show answer/ }).click();
    await page.keyboard.press('2');
    await expect(stat(page, 'Learning')).toHaveText('1');
    expect(await doc(page)).toBeNull(); // still waiting to be written

    await page.evaluate(() => {
      (window as unknown as { heard: Promise<boolean> }).heard = new Promise((r) => addEventListener('storage', () => r(true), { once: true }));
    });
    const other = await context.newPage();
    await other.goto('about/');
    await other.evaluate((k) => {
      const d = JSON.parse(localStorage.getItem(k) || '{"version":1}');
      d.plan = { last: 'long', done: { long: [1] } };
      localStorage.setItem(k, JSON.stringify(d));
    }, KEY);
    await page.evaluate(() => (window as unknown as { heard: Promise<boolean> }).heard); // a real storage event, inside the delay

    await page.clock.runFor(200);
    await expect.poll(async () => Object.keys((await doc(page))?.cards ?? {}).length).toBe(1);
    expect((await doc(page)).plan.last).toBe('long'); // and the other tab's change is still there
  });

  test('a planner tick that could not be saved stays on its own plan when replayed later', async ({ page, context }) => {
    await page.goto('interview/study-guide/#short');
    await expect(page.locator('li[data-i="0"]')).toBeVisible();
    await breakWrites(page);
    await page.locator('li[data-i="0"] input').click();
    await page.locator('[data-t="long"]').click(); // moves on to another plan with the tick still unsaved
    await expect(page.locator('.save-warn')).toBeVisible();

    await page.evaluate(() => {
      (window as unknown as { heard: Promise<boolean> }).heard = new Promise((r) => addEventListener('storage', () => r(true), { once: true }));
    });
    const other = await context.newPage();
    await other.goto('about/');
    await other.evaluate((k) => {
      const d = JSON.parse(localStorage.getItem(k) || '{"version":1}');
      d.settings = { newCardsPerDay: 20 };
      localStorage.setItem(k, JSON.stringify(d));
    }, KEY);
    await page.evaluate(() => (window as unknown as { heard: Promise<boolean> }).heard);

    await fixWrites(page);
    await page.locator('[data-t="short"]').click(); // the next change writes everything
    await expect(page.locator('.save-warn')).toBeHidden();
    const saved = await doc(page);
    expect(saved.plan.done.short).toEqual([0]);
    expect(saved.plan.done.long ?? []).toEqual([]);
    expect(saved.settings.newCardsPerDay).toBe(20);
  });

  test('a section this version does not know about survives a save and an export', async ({ page }, info) => {
    await seed(page, { [KEY]: { version: 1, future: { streak: 12 } } });
    await page.goto('practice/flashcards/');
    await page.getByRole('button', { name: /Show answer/ }).click();
    await page.keyboard.press('2');
    await expect.poll(async () => Object.keys((await doc(page))?.cards ?? {}).length).toBe(1);
    expect((await doc(page)).future).toEqual({ streak: 12 });

    await page.goto('about/');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export progress' }).click()]);
    const file = info.outputPath('progress.json');
    await download.saveAs(file);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).future).toEqual({ streak: 12 });
  });

  test('stored JSON that is not a document is set aside, not overwritten', async ({ page }) => {
    await seed(page, { [KEY]: '[1,2,3]' });
    await page.goto('practice/flashcards/');
    await page.getByRole('button', { name: /Show answer/ }).click();
    await page.keyboard.press('2');
    await expect.poll(async () => Object.keys((await doc(page))?.cards ?? {}).length).toBe(1);
    expect(await page.evaluate((k) => localStorage.getItem(`${k}:corrupt`), KEY)).toBe('[1,2,3]');
  });
});

test.describe('counts and resets', () => {
  test('cards no longer in the deck are not counted as due anywhere', async ({ page }) => {
    const past = Date.now() - 3 * DAY;
    const item = { box: 1, due: past, seen: 1, lapses: 0 };
    await seed(page, { [KEY]: { version: 1, cards: { 'Cache-aside': item, Sharding: item, 'A card removed from the deck': item } } });
    await page.goto('learn/cache/');
    if (!(await page.locator('#sidebar').isVisible())) await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.locator('[data-due-badge]')).toHaveText('2');

    await page.goto('practice/flashcards/');
    await expect(stat(page, 'Due')).toHaveText('2');

    await page.goto('progress/');
    await expect(page.locator('.prog-next p').nth(1)).toHaveText('2 cards due');
    await expect(page.locator('.prog-cards > div', { hasText: 'Due' }).locator('dd')).toHaveText('2');
  });

  test('only removed cards due: no badge and no nudge to review them', async ({ page }) => {
    const past = Date.now() - 3 * DAY;
    await seed(page, { [KEY]: { version: 1, cards: { 'A card removed from the deck': { box: 1, due: past, seen: 1, lapses: 0 } } } });
    await page.goto('learn/cache/');
    await expect(page.locator('[data-due-badge]')).toHaveText('0');
    await expect(page.locator('[data-due-badge]')).toBeHidden();
    await page.goto('progress/');
    await expect(page.locator('.prog-next h2')).not.toHaveText('Review your flashcards');
  });

  test('nothing due: the deck list is not fetched', async ({ page }) => {
    const fetched: string[] = [];
    page.on('request', (r) => { if (r.url().includes('flashcard-keys')) fetched.push(r.url()); });
    await page.goto('learn/cache/');
    await expect(page.locator('[data-due-badge]')).toHaveText('0');
    expect(fetched).toEqual([]);
  });

  for (const [button, section] of [['Reset exercises', 'exercises'], ['Reset decision aids', 'choosers'], ['Reset scaling story', 'paths']] as const) {
    test(`${button} clears that section and leaves the rest`, async ({ page }) => {
      await seed(page, { [KEY]: {
        version: 1,
        plan: { last: 'long', done: {} },
        exercises: { ex: { attempts: 2, hints: 1 } },
        choosers: { db: { guided: 1, attempts: [] } },
        paths: { 'scaling-story': { stage: 3 } },
      } });
      await page.goto('about/');
      await page.getByText('Reset', { exact: true }).click();
      await page.getByRole('button', { name: button }).click();
      expect(Object.keys((await doc(page))[section])).toHaveLength(1); // the first click only arms it
      await page.getByRole('button', { name: 'Click again to confirm' }).click();
      await expect(page.locator('.dp-msg')).toHaveText('Reset.');
      await expect.poll(async () => Object.keys((await doc(page))[section])).toHaveLength(0);
      const after = await doc(page);
      expect(after.plan.last).toBe('long');
      for (const s of ['exercises', 'choosers', 'paths'].filter((x) => x !== section)) expect(Object.keys(after[s])).toHaveLength(1);
    });
  }
});
