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
