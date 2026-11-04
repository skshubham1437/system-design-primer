import { expect, test } from '@playwright/test';

test('search finds a topic from the keyboard', async ({ page, isMobile }) => {
  await page.goto('learn/cache/');
  if (isMobile) await page.getByRole('button', { name: 'Search' }).click();
  else await page.keyboard.press('/');
  await page.getByRole('searchbox', { name: 'Search' }).fill('sharding');
  const first = page.locator('.result').first();
  await expect(first).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/sharding|database/);
});

test('mobile drawer opens, closes with Escape, and hides links when closed', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'drawer is mobile only');
  await page.goto('learn/cache/');
  const sidebar = page.locator('#sidebar');
  await expect(sidebar).toBeHidden();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(sidebar).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sidebar).toBeHidden();
});

test('capacity estimator recalculates when an assumption changes', async ({ page }) => {
  await page.goto('labs/estimator/');
  const peakReads = page.locator('.est-card:has(.est-label:text-is("Peak reads")) b');
  await expect(peakReads).toBeVisible();
  const before = await peakReads.textContent();
  await page.locator('input[data-f="dau"]').fill('10000000');
  await expect(peakReads).not.toHaveText(before!);
});

test('consistent hashing reports far fewer moved keys than modulo hashing', async ({ page }) => {
  await page.goto('labs/consistent-hashing/');
  await page.locator('#ch-add').click();
  const nums = await page.locator('.ch-compare b').allTextContents();
  const [ch, mod] = nums.map((n) => parseFloat(n));
  expect(ch).toBeLessThan(mod);
});

test('CAP lab: a partitioned CP node refuses to answer', async ({ page }) => {
  await page.goto('labs/cap-theorem/');
  await page.locator('[data-w="0"]').click();
  await page.locator('#cap-part').click();
  await page.locator('[data-r="2"]').click();
  await expect(page.locator('#cap-log p').first()).toContainText('refused');
});

test('study planner remembers a ticked item after reload', async ({ page }) => {
  await page.goto('interview/study-guide/#short');
  await page.locator('.plan-list li').first().click();
  await expect(page.locator('.plan-foot span')).toContainText('1 of');
  await page.reload();
  await expect(page.locator('.plan-foot span')).toContainText('1 of');
});

test('load balancing reports medians over 20 runs, and least connections has the best tail', async ({ page }) => {
  await page.goto('labs/load-balancing/');
  await expect(page.locator('.lb-runs')).toContainText('20 runs');
  const best = page.locator('#lb-table tr:has(td.best) td:first-child');
  await expect(best).toContainText('Least connections');
});

test('CAP in AP mode: a conflict discards only the other side\'s last value', async ({ page }) => {
  await page.goto('labs/cap-theorem/');
  await page.getByRole('button', { name: /AP/ }).click();
  await page.locator('#cap-part').click();
  await page.locator('[data-w="2"]').click(); // v1 on the isolated node
  await page.locator('[data-w="0"]').click(); // v2 on the majority
  await page.locator('[data-w="0"]').click(); // v3 overwrites v2 on its own side
  await page.locator('#cap-part').click();
  const msg = page.locator('#cap-log p').first();
  await expect(msg).toContainText('kept v3');
  await expect(msg).toContainText('discarded v1');
  await expect(msg).not.toContainText('v2');
});

test('load balancing: a dead server loses requests until health checks remove it', async ({ page }) => {
  await page.goto('labs/load-balancing/');
  await page.getByLabel(/Server 1 dies/).check();
  const failed = (name: string) => page.locator('#lb-table tbody tr', { has: page.locator('td:first-child', { hasText: new RegExp(`^${name}$`) }) }).locator('td').nth(3);
  const blind = Number(await failed('Round robin').textContent());
  expect(blind).toBeGreaterThan(5);
  await page.getByLabel(/Health checks/).check();
  await expect(failed('Round robin')).not.toHaveText(String(blind));
  expect(Number(await failed('Round robin').textContent())).toBeLessThan(blind);
  await page.getByRole('button', { name: /Least connections/ }).click();
  await expect(page.locator('#lb-goal')).toContainText('Done');
});

// The every-page test checks 1280 and 375 pixels. The header once overflowed between about 960 and 1135, on every page.
test('no page width in between scrolls sideways', async ({ page }) => {
  for (const width of [1160, 1135, 1100, 1024, 961, 960, 820, 768, 600]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('learn/cache/');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${width} pixels wide`).toBeLessThanOrEqual(0);
  }
});
