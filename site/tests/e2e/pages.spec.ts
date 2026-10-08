import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Every page: no console errors, no sideways scrolling, no serious accessibility violations.
// Pages come from the site's own search index, so new pages are covered automatically.

interface Entry { p: string }

for (const theme of ['light', 'dark'] as const) test.describe(`every page (${theme} theme)`, () => {
  let paths: string[] = [];

  test.beforeAll(async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}search-index.json`);
    expect(res.ok()).toBeTruthy();
    const entries = (await res.json()) as Entry[];
    paths = ['', 'learn/', 'labs/', 'practice/', 'interview/', 'reference/', 'progress/', 'quiz/', ...entries.map((e) => e.p)];
  });

  test('load cleanly, fit the screen, and pass axe including contrast', async ({ page }, info) => {
    test.setTimeout(300_000);
    await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console ${m.text()}`); });
    page.on('requestfailed', (r) => { if (!/fonts|favicon/.test(r.url())) problems.push(`request failed ${r.url()}`); });

    for (const p of paths) {
      await page.goto(p, { waitUntil: 'load' });
      await page.waitForTimeout(150); // let lazy widgets mount

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) problems.push(`${p}: sideways overflow of ${overflow}px`);

      const axe = await new AxeBuilder({ page }).analyze();
      for (const v of axe.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')) {
        problems.push(`${p}: axe ${v.id} (${v.impact}) on ${v.nodes.length} node(s): ${v.nodes[0]?.target.join(' ')}`);
      }
    }
    expect(problems, `${info.project.name}:\n${problems.join('\n')}`).toEqual([]);
  });
});
