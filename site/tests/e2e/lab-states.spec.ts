import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The every-page test only sees each lab in its starting state. These put each lab into the states that
// change colours and text (failures, stale reads, drops) and check accessibility there, in both themes.

const states: { name: string; path: string; act: (page: Page) => Promise<void> }[] = [
  { name: 'replication after a crash', path: 'labs/replication/', act: async (p) => {
    const r = p.locator('.v-repl');
    await r.getByRole('button', { name: 'Write', exact: true }).click();
    await r.getByRole('button', { name: 'Read here' }).nth(1).click();
    await r.getByRole('button', { name: 'Crash the primary' }).click();
  } },
  { name: 'CAP after a conflict', path: 'labs/cap-theorem/', act: async (p) => {
    await p.getByRole('button', { name: /AP/ }).click();
    await p.locator('#cap-part').click();
    await p.locator('[data-w="2"]').click();
    await p.locator('[data-w="0"]').click();
    await p.locator('[data-r="2"]').click();
  } },
  { name: 'load balancing with a dead server', path: 'labs/load-balancing/', act: async (p) => {
    await p.getByLabel(/Server 1 dies/).check();
    await p.locator('.lb .player [data-pl="toggle"]').click(); // pause
    for (let i = 0; i < 70; i++) await p.locator('.lb .player [data-pl="step"]').click();
  } },
  { name: 'queue dropping, then under back pressure', path: 'labs/message-queue/', act: async (p) => {
    await p.locator('.v-queue .player [data-pl="toggle"]').click();
    for (let i = 0; i < 30; i++) await p.locator('.v-queue .player [data-pl="step"]').click();
    await p.locator('#q-bp').check();
    for (let i = 0; i < 10; i++) await p.locator('.v-queue .player [data-pl="step"]').click();
  } },
  { name: 'cache eviction mid-replay', path: 'labs/cache-eviction/', act: async (p) => {
    for (let i = 0; i < 12; i++) await p.locator('#ce-next').click();
  } },
  { name: 'DNS walk', path: 'labs/dns-resolution/', act: async (p) => { await p.locator('#d-go').click(); await p.waitForTimeout(300); } },
  { name: 'CDN after an origin fetch', path: 'labs/cdn/', act: async (p) => {
    await p.getByRole('button', { name: /Pull CDN/ }).click();
    await p.locator('[data-req="eu"]').click();
  } },
  { name: 'scaling story in predict mode', path: 'labs/scaling-story/', act: async (p) => {
    await p.getByRole('button', { name: /Stage 5/ }).click();
    await p.getByLabel(/Predict first/).check();
  } },
];

for (const theme of ['light', 'dark'] as const) test.describe(`lab states (${theme})`, () => {
  for (const s of states) test(`${s.name} passes axe`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(s.path);
    await s.act(page);
    const axe = await new AxeBuilder({ page }).include('.widget').analyze();
    const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
  });
});
