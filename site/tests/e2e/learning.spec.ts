import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';

const KEY = 'primer:v1';
const DAY = 86_400_000;

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
    await expect(stat(page, 'New')).toHaveText('42');
    await expect(stat(page, 'Due')).toHaveText('0');

    await page.getByRole('button', { name: /Show answer/ }).click();
    await page.keyboard.press('2'); // Good
    await expect(stat(page, 'New')).toHaveText('41');
    await expect(stat(page, 'Learning')).toHaveText('1');

    await expect.poll(async () => Object.keys((await doc(page))?.cards ?? {}).length).toBe(1);
    const [card] = Object.values((await doc(page)).cards) as { box: number; due: number }[];
    expect(card.box).toBe(1);
    expect(card.due).toBeGreaterThan(Date.now());
    expect(card.due).toBeLessThan(Date.now() + 2 * DAY);

    await page.reload();
    await expect(stat(page, 'New')).toHaveText('41');
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
    await expect(stat(page, 'New')).toHaveText('40');

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
