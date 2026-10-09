import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const KEY = 'primer:v1';
const doc = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);

interface Data { start: string; nodes: Record<string, { options: { label: string; next?: string; result?: string }[] }>; results: Record<string, { title: string }>; scenarios: { scenario: string; options: { label: string }[]; answer: number }[] }
const load = async (page: Page) => (await (await page.request.get('data/chooser/sql-or-nosql.json')).json()) as Data;

test.describe('decision aid: SQL or NoSQL', () => {
  test('is on the database page, and is marked as a draft', async ({ page }) => {
    await page.goto('learn/database/');
    const c = page.locator('.widget.chooser');
    await expect(c.getByRole('heading', { name: 'SQL or NoSQL?' })).toBeVisible();
    await expect(c.locator('.chooser-draft')).toContainText('Draft');
  });

  test('guide me: transactions lead straight to a relational database, and the costs are shown', async ({ page }) => {
    await page.goto('learn/database/');
    const c = page.locator('.widget.chooser');
    await c.getByRole('button', { name: /Yes, correctness across several records matters/ }).click();
    await expect(c.locator('#ch-focus')).toHaveText('A relational (SQL) database');
    await expect(c.locator('.ch-costs')).toContainText('What it costs you');
    await expect(c.locator('.ch-costs li')).toHaveCount(2);
    await expect(c.getByRole('link', { name: 'Read the section' })).toHaveAttribute('href', /learn\/database\/#relational-database-management-system-rdbms/);
  });

  test('guide me: every path in the tree reaches a recommendation (no dead ends)', async ({ page }) => {
    await page.goto('learn/database/');
    const data = await load(page);
    // depth-first: collect every path as a list of option indexes
    const paths: number[][] = [];
    const walk = (id: string, so: number[]) => data.nodes[id].options.forEach((o, i) => (o.result ? paths.push([...so, i]) : walk(o.next!, [...so, i])));
    walk(data.start, []);
    expect(paths.length).toBeGreaterThanOrEqual(7);
    const c = page.locator('.widget.chooser');
    for (const p of paths) {
      for (const i of p) await c.locator(`[data-opt="${i}"]`).click();
      await expect(c.locator('.ch-costs')).toBeVisible();
      await c.getByRole('button', { name: 'Start again' }).click();
    }
  });

  test('guide me: back undoes the last answer, and the keyboard works', async ({ page }) => {
    await page.goto('learn/database/');
    const c = page.locator('.widget.chooser');
    await c.getByRole('button', { name: /No, each record stands alone/ }).click();
    await expect(c.locator('#ch-focus')).toContainText('relational');
    await c.getByRole('button', { name: 'Back' }).click();
    await expect(c.locator('#ch-focus')).toContainText('transactions');
    await c.locator('#ch-focus').focus();
    await page.keyboard.press('1');
    await expect(c.locator('.ch-costs')).toBeVisible();
  });

  test('test me: you commit first, then every option is explained and the right one is marked', async ({ page }) => {
    await page.goto('learn/database/');
    const data = await load(page);
    const c = page.locator('.widget.chooser');
    await c.getByRole('button', { name: /Test me/ }).click();
    await expect(c.locator('.quiz-count')).toContainText(`Scenario 1 of ${data.scenarios.length}`);
    await expect(c.locator('.ch-opt-why, .quiz-flag')).toHaveCount(0);       // nothing revealed yet
    const wrong = (data.scenarios[0].answer + 1) % data.scenarios[0].options.length;
    await c.locator(`[data-pick="${wrong}"]`).click();
    await expect(c.locator('.ch-opt-why')).toHaveCount(data.scenarios[0].options.length);
    await expect(c.locator('.quiz-flag', { hasText: 'Best fit' })).toHaveCount(1);
    await expect(c.locator('.quiz-flag', { hasText: 'Your pick' })).toHaveCount(1);
  });

  test('test me: a full run scores correctly and saves the attempt', async ({ page }) => {
    await page.goto('learn/database/');
    const data = await load(page);
    const c = page.locator('.widget.chooser');
    await c.getByRole('button', { name: /Test me/ }).click();
    for (let i = 0; i < data.scenarios.length; i++) {
      const s = data.scenarios[i];
      const pick = i === 1 ? (s.answer + 1) % s.options.length : s.answer; // get exactly one wrong
      await c.locator(`[data-pick="${pick}"]`).click();
      await c.getByRole('button', { name: /Next scenario|See results/ }).click();
    }
    await expect(c.locator('#ch-focus')).toHaveText(`${data.scenarios.length - 1} of ${data.scenarios.length}`);
    await expect(c.locator('.quiz-review li.bad')).toHaveCount(1);
    await expect.poll(async () => (await doc(page))?.choosers?.['sql-or-nosql']?.attempts?.length).toBe(1);
    const a = (await doc(page)).choosers['sql-or-nosql'].attempts[0];
    expect(a).toMatchObject({ score: data.scenarios.length - 1, of: data.scenarios.length });
  });

  test('counts a completed guided path', async ({ page }) => {
    await page.goto('learn/database/');
    await page.locator('.widget.chooser [data-opt="0"]').click();
    await expect.poll(async () => (await doc(page))?.choosers?.['sql-or-nosql']?.guided).toBe(1);
  });

  for (const theme of ['light', 'dark']) {
    test(`pass axe in every state, ${theme} theme`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
      await page.goto('learn/database/');
      const data = await load(page);
      const check = async (label: string) => {
        const { violations } = await new AxeBuilder({ page }).analyze();
        expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${label}: ${v.id} ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
      };
      const c = page.locator('.widget.chooser');
      await check('guide question');
      await c.locator('[data-opt="0"]').click();
      await check('guide result');
      await c.getByRole('button', { name: /Test me/ }).click();
      await check('scenario');
      await c.locator(`[data-pick="${data.scenarios[0].answer}"]`).click();
      await check('scenario answered');
    });
  }
});
