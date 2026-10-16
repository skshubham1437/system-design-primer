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

test.describe('database animations', () => {
  test('B-tree: inserting past capacity splits a page; a range scan walks the leaves', async ({ page }) => {
    await page.goto('databases/btree-indexes/');
    const w = page.locator('.v-btree');
    const pages = w.locator('#bt-stats div', { hasText: 'Pages' }).locator('dd');
    const before = Number(await pages.textContent());
    await w.getByRole('button', { name: 'Insert 8 more in a row' }).click();
    await w.locator('[data-pl="toggle"]').click();
    for (let i = 0; i < 12; i++) await w.locator('[data-pl="step"]').click();
    expect(Number(await pages.textContent())).toBeGreaterThan(before);
    await w.getByRole('button', { name: 'Range scan' }).click();
    await w.locator('[data-pl="toggle"]').click();
    for (let i = 0; i < 12; i++) await w.locator('[data-pl="step"]').click();
    await expect(w.locator('#bt-note')).toContainText('in order, after one descent');
  });

  test('scan types: for a common range the bitmap scan reads each page once and the index scan does not', async ({ page }) => {
    await page.goto('databases/scan-types/');
    const w = page.locator('.v-scans');
    await w.getByRole('button', { name: /Common/ }).click();
    const row = (name: string) => w.locator('#sc-table tbody tr', { hasText: name }).locator('td').nth(1);
    expect(Number(await row('Index scan').textContent())).toBeGreaterThan(Number(await row('Sequential scan').textContent()));
    expect(Number(await row('Bitmap scan').textContent())).toBeLessThanOrEqual(Number(await row('Sequential scan').textContent()));
  });

  test('composite index: the second column alone needs a skip scan', async ({ page }) => {
    await page.goto('databases/index-design/');
    const w = page.locator('.v-composite');
    await w.getByRole('button', { name: /status = banned only/ }).click();
    await expect(w.locator('#ci-note')).toContainText('skip scan');
    await w.getByRole('button', { name: 'country = DE', exact: true }).click();
    await expect(w.locator('#ci-stats')).toContainText('Slices1');
  });

  test('plan stepper: steps through a real plan and explains the flagged node', async ({ page }) => {
    await page.goto('databases/reading-plans/');
    const w = page.locator('.v-plan');
    await expect(w.locator('#pt-panel')).toContainText('Most of the time went to');
    await w.locator('[data-pl="step"]').click();
    await expect(w.locator('.pt-node.on')).toHaveCount(1);
    await w.locator('.pt-node.flag').first().click();
    await expect(w.locator('.pt-flags')).toContainText('index');
    await expect(page.locator('.db-plan-host details.widget-original')).toBeAttached();
  });
});

test.describe('query-tuning exercises', () => {
  test.setTimeout(150_000);

  test('the static version is readable before the script loads', async ({ page }) => {
    await page.goto('databases/tuning-exercises/');
    await expect(page.locator('.sqlx-host')).toHaveCount(12);
  });

  test('explain the original, take the answer, pass every check, and see it on the progress page', async ({ page }) => {
    await page.goto('databases/btree-indexes/');
    const x = page.locator('.sqlx').first();
    await expect(x.getByRole('heading', { name: "One customer's orders" })).toBeVisible();
    await x.getByRole('button', { name: /Show a hint/ }).click();
    await expect(x.locator('.sqlx-hints li')).toHaveCount(1);

    await x.getByRole('button', { name: 'Explain the original' }).click();
    await expect(x.locator('.sqlx-verdict')).toContainText('starting point', { timeout: 90_000 });
    await expect(x.locator('.sqlx-checks li.no').first()).toBeVisible();

    // a wrong answer: fast but returns different rows
    await x.locator('textarea').last().fill('select id, status, created_at, total from orders where user_id = 43 order by created_at desc');
    await x.getByRole('button', { name: 'Check my answer' }).click();
    await expect(x.locator('.sqlx-checks')).toContainText('Returns the same rows');
    await expect(x.locator('.sqlx-verdict')).toContainText('Not yet');

    await x.getByRole('button', { name: 'Show the answer' }).click();
    await x.getByRole('button', { name: 'Check my answer' }).click();
    await expect(x.locator('.sqlx-verdict')).toContainText('Solved', { timeout: 60_000 });
    await expect(x.locator('.sqlx-why')).toContainText('Why it was slow');
    await expect(x.locator('.sqlx-solved')).toBeVisible();

    for (const theme of ['light', 'dark']) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      const axe = await new AxeBuilder({ page }).include('.sqlx').analyze();
      expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${theme} ${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
    }

    await page.goto('progress/');
    await expect(page.locator('.prog-h', { hasText: 'Query-tuning exercises' })).toContainText('1 of 12 solved');
  });
});

test('join animation: a hash join compares far fewer pairs than a plain nested loop', async ({ page }) => {
  await page.goto('databases/joins/');
  const w = page.locator('.v-joins');
  const comparisons = w.locator('#j-stats div', { hasText: 'Comparisons' }).locator('dd');
  const finish = async () => { for (let i = 0; i < 20; i++) await w.locator('[data-pl="step"]').click(); return Number(await comparisons.textContent()); };
  const nested = await finish();
  await w.getByRole('button', { name: 'Hash join', exact: true }).click();
  const hash = await finish();
  expect(hash).toBeLessThan(nested / 2);
  await expect(w.locator('#j-buckets')).toBeVisible();
  await w.getByRole('button', { name: 'Merge join' }).click();
  await finish();
  await expect(w.locator('#j-note')).toContainText('one pass over each side');
});

test('recorded traces: the deadlock replay shows one session waiting, then the server aborting one side', async ({ page }) => {
  await page.goto('databases/locks-and-deadlocks/');
  const w = page.locator('.v-trace', { hasText: 'A deadlock' });
  await expect(w).toContainText('PostgreSQL 18');
  const step = w.locator('[data-pl="step"]');
  for (let i = 0; i < 4; i++) await step.click();
  await expect(w.locator('.tx-sess[data-state="waiting"]')).toHaveCount(1);
  await expect(w.locator('.tx-locks')).toContainText('waiting for');
  for (let i = 0; i < 3; i++) await step.click();
  await expect(w.locator('.tx-log')).toContainText('deadlock detected');
});

test('recorded traces read as a plain list without the replay', async ({ page }) => {
  await page.route('**/data/db/traces/**', (r) => r.abort());
  await page.goto('databases/isolation-and-mvcc/');
  await expect(page.locator('.trace-static').first()).toContainText('Recorded on PostgreSQL 18');
});
