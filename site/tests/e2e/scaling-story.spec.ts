import { expect, test } from '@playwright/test';

test.describe('scaling story', () => {
  test('stepping through the stages grows the diagram and remembers where you were', async ({ page }) => {
    await page.goto('labs/scaling-story/');
    const root = page.locator('.v-story');
    await expect(root.locator('.story-title')).toHaveText('One server does everything');
    const boxes = () => root.locator('.st-box').count();
    const first = await boxes();

    await root.getByRole('button', { name: 'Next stage' }).click();
    await root.getByRole('button', { name: 'Next stage' }).click();
    await expect(root.locator('.story-title')).toContainText('load balancer');
    expect(await boxes()).toBeGreaterThan(first);

    await page.reload();
    await expect(root.locator('.story-title')).toContainText('load balancer');
    await root.getByRole('button', { name: 'Stage 1: One server does everything' }).click();
    await expect(root.getByRole('button', { name: 'Previous stage' })).toBeDisabled();
  });

  test('predict-first hides the fix until you ask for it', async ({ page }) => {
    await page.goto('labs/scaling-story/');
    const root = page.locator('.v-story');
    await root.getByRole('button', { name: 'Stage 4: Cache the hot reads' }).click();
    await root.getByLabel(/Predict first/).check();
    await expect(root.locator('.story-block.cost')).toHaveCount(0);
    await root.getByRole('button', { name: 'Show the fix' }).click();
    await expect(root.locator('.story-block.cost')).toBeVisible();
    await expect(root.locator('.story-panel')).toContainText('cache-aside');
  });

  test('the plain-text version of every stage is still on the page', async ({ page }) => {
    await page.goto('labs/scaling-story/');
    await page.locator('.story-text summary').click();
    await expect(page.locator('.story-text h3')).toHaveCount(9);
  });
});

test('topic pages list what to read first', async ({ page }) => {
  await page.goto('learn/cache/');
  const chips = page.locator('.prereqs');
  await expect(chips).toContainText('Before this');
  await expect(chips.getByRole('link').first()).toBeVisible();
});
