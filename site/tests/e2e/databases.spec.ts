import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('the Databases section is in the navigation and lists its pages', async ({ page }) => {
  await page.goto('databases/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('slow queries');
  await expect(page.locator('.card-grid a').first()).toBeVisible();
  // on phones the section links live in the drawer, so check the link exists rather than that it is on screen
  await expect(page.locator('a.nav-link[href$="databases/"]').first()).toBeAttached();
});

test('playground pages show real output produced at build time, and say so', async ({ page }) => {
  await page.goto('databases/playground/');
  await expect(page.locator('.draft-note')).toContainText('real run on PostgreSQL');
  const run = page.locator('.db-run').first();
  await expect(run).toContainText('real output from PostgreSQL');
  await expect(run.locator('td').first()).toHaveText('users');
});

test.describe('the playground engine', () => {
  test.setTimeout(120_000);

  test('does not download the engine until asked', async ({ page }) => {
    const wasm: string[] = [];
    page.on('request', (r) => { if (/\.wasm|pglite/.test(r.url())) wasm.push(r.url()); });
    await page.goto('databases/playground/');
    await expect(page.getByRole('button', { name: 'Start the database' })).toBeVisible();
    await page.waitForTimeout(500);
    expect(wasm).toEqual([]);
  });

  test('runs a query, explains it, and an index changes the plan', async ({ page }) => {
    await page.goto('databases/playground/');
    await page.getByRole('button', { name: 'Start the database' }).click();
    const status = page.locator('#sqlp-status');
    await expect(status).toContainText('Ready', { timeout: 90_000 });

    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(page.locator('#sqlp-out table')).toContainText('delivered');

    await page.getByRole('button', { name: "One user's orders" }).click();
    await page.getByRole('button', { name: 'Explain analyze' }).click();
    await expect(page.locator('#sqlp-out')).toContainText('Seq Scan on orders');

    await page.getByRole('button', { name: 'Add an index' }).click();
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(status).toContainText('Done');
    await page.getByRole('button', { name: "One user's orders" }).click();
    await page.getByRole('button', { name: 'Explain analyze' }).click();
    await expect(page.locator('#sqlp-out')).toContainText('orders_user_id_idx');

    // errors are shown, not thrown
    await page.locator('#sqlp-sql').fill('select * from no_such_table');
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('.db-error')).toContainText('does not exist');

    for (const theme of ['light', 'dark']) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      const axe = await new AxeBuilder({ page }).include('.sqlp').analyze();
      expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${theme} ${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
    }
  });
});
