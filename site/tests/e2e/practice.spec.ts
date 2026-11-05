import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const KEY = 'primer:v1';
const PATH = 'practice/system-design/pastebin/';
const doc = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
const sol = async (page: Page) => (await doc(page))?.solutions?.[PATH];

test.describe('solution practice mode', () => {
  test('reading is unchanged: every step is visible and the follow-ups are on the page', async ({ page }) => {
    await page.goto(PATH);
    await expect(page.locator('.practice-panel')).toBeHidden();
    for (const id of ['step-1-outline-use-cases-and-constraints', 'step-4-scale-the-design']) {
      await expect(page.locator(`[data-step="${id}"]`)).toBeVisible();
    }
    await expect(page.locator('.followups details')).toHaveCount(6);
  });

  test('works without the practice scripts: the page is still a full, readable solution', async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto(PATH);
    await expect(page.locator('[data-step="step-3-design-core-components"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Push it further' })).toBeVisible();
    await ctx.close();
  });

  test('try it first: the reference stays hidden until you ask, and your notes and ticks are saved', async ({ page }) => {
    await page.goto(PATH);
    await page.getByRole('button', { name: /Try it first/ }).click();
    const panel = page.locator('.practice-panel');
    await expect(panel).toContainText('Step 1 of 4');
    await expect(page.locator('[data-step="step-1-outline-use-cases-and-constraints"]')).toBeHidden();
    await expect(page.locator('.concepts')).toBeHidden(); // concept chips would be spoilers

    await panel.locator('#pp-notes').fill('Ask about users, reads and writes. About 4 writes/s.');
    await panel.getByRole('button', { name: 'Reveal the reference' }).click();
    await expect(page.locator('[data-step="step-1-outline-use-cases-and-constraints"]')).toBeVisible();
    await expect(page.locator('[data-step="step-2-create-a-high-level-design"]')).toBeHidden();

    await panel.locator('input[data-r="0"]').check();
    await panel.locator('input[data-r="2"]').check();
    await expect.poll(async () => (await sol(page))?.rubric?.['step-1-outline-use-cases-and-constraints']).toEqual(['0', '2']);
    const saved = await sol(page);
    expect(saved.notes['step-1-outline-use-cases-and-constraints']).toContain('4 writes/s');
    expect(saved.status).toBe('attempted');
  });

  test('walks all four steps, shows what was missed, and can mark the solution done', async ({ page }) => {
    await page.goto(PATH);
    await page.getByRole('button', { name: /Try it first/ }).click();
    const panel = page.locator('.practice-panel');
    for (let i = 1; i <= 4; i++) {
      await expect(panel).toContainText(`Step ${i} of 4`);
      await panel.getByRole('button', { name: 'Reveal the reference' }).click();
      await panel.locator('input[data-r="0"]').check(); // tick only the first item each time
      await panel.getByRole('button', { name: i === 4 ? 'Finish' : 'Next step' }).click();
    }
    await expect(panel.getByRole('heading', { name: 'What to work on' })).toBeVisible();
    await expect(panel.locator('.pp-score').first()).toHaveText(/^1 of \d$/);
    await expect(panel.locator('.pp-missed').first()).toContainText('To cover:');
    await panel.getByRole('button', { name: 'Mark this solution as done' }).click();
    await expect.poll(async () => (await sol(page))?.status).toBe('done');
  });

  test('picks up where you left off after a reload', async ({ page }) => {
    await page.goto(PATH);
    await page.getByRole('button', { name: /Try it first/ }).click();
    await page.locator('.practice-panel').getByRole('button', { name: 'Next step' }).click();
    await expect(page.locator('.practice-panel')).toContainText('Step 2 of 4');
    await expect.poll(async () => (await sol(page))?.step).toBe('step-2-create-a-high-level-design');
    await page.reload();
    await expect(page.locator('.practice-panel')).toContainText('Step 2 of 4');
  });

  test('switching back to reading shows the whole solution again', async ({ page }) => {
    await page.goto(PATH);
    await page.getByRole('button', { name: /Try it first/ }).click();
    await page.getByRole('button', { name: /Read the solution/ }).click();
    await expect(page.locator('[data-step="step-4-scale-the-design"]')).toBeVisible();
    await expect(page.locator('.practice-panel')).toBeHidden();
  });

  test('follow-up answers are hidden until opened', async ({ page }) => {
    await page.goto(PATH);
    const first = page.locator('.followups details').first();
    await expect(first.locator('p')).toBeHidden();
    await first.locator('summary').click();
    await expect(first.locator('p')).toBeVisible();
  });

  test('flags the pilot rubric as a draft', async ({ page }) => {
    await page.goto(PATH);
    await page.getByRole('button', { name: /Try it first/ }).click();
    await expect(page.locator('.practice-panel .quiz-draft')).toContainText('Draft');
  });

  for (const theme of ['light', 'dark']) {
    test(`practice states pass axe in the ${theme} theme`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
      await page.goto(PATH);
      const check = async (label: string) => {
        const { violations } = await new AxeBuilder({ page }).analyze();
        expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${label}: ${v.id} ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
      };
      await page.getByRole('button', { name: /Try it first/ }).click();
      await check('step prompt');
      await page.locator('.practice-panel').getByRole('button', { name: 'Reveal the reference' }).click();
      await check('step with rubric');
      for (let i = 0; i < 4; i++) await page.locator('.practice-panel').getByRole('button', { name: /Next step|Finish/ }).click();
      await check('summary');
    });
  }
});
