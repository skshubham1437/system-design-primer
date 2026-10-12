import { expect, test } from '@playwright/test';

test.describe('replication', () => {
  test('async: a read right after a write is stale; a crash before copying loses acknowledged writes', async ({ page }) => {
    await page.goto('labs/replication/');
    const root = page.locator('.v-repl');
    await root.getByRole('button', { name: 'Write', exact: true }).click();
    await root.getByRole('button', { name: 'Write', exact: true }).click();
    await root.getByRole('button', { name: 'Read here' }).nth(1).click();
    await expect(root.locator('#r-status')).toContainText('stale read');

    await root.getByRole('button', { name: 'Crash the primary' }).click();
    await root.getByRole('button', { name: 'Promote a replica' }).click();
    await expect(root.locator('#r-log li').first()).toContainText('gone for good');
  });

  test('sync: nothing acknowledged is lost when the primary crashes', async ({ page }) => {
    await page.goto('labs/replication/');
    const root = page.locator('.v-repl');
    await root.getByRole('button', { name: /Synchronous/ }).click();
    await root.getByRole('button', { name: 'Write', exact: true }).click();
    await root.getByRole('button', { name: 'Crash the primary' }).click();
    await root.getByRole('button', { name: 'Promote a replica' }).click();
    await expect(root.locator('#r-log li').first()).toContainText('Nothing that was acknowledged was lost');
  });

  test('controls are disabled when they cannot apply', async ({ page }) => {
    await page.goto('labs/replication/');
    const root = page.locator('.v-repl');
    await expect(root.getByRole('button', { name: 'Promote a replica' })).toBeDisabled();
    await root.getByRole('button', { name: 'Crash the primary' }).click();
    await expect(root.getByRole('button', { name: 'Write', exact: true })).toBeDisabled();
    await expect(root.getByRole('button', { name: 'Promote a replica' })).toBeEnabled();
  });
});

test.describe('sharding', () => {
  test('only range sharding answers a name-prefix query from one shard', async ({ page }) => {
    await page.goto('labs/sharding/');
    const root = page.locator('.v-sharding');
    const prefix = root.locator('.v-query', { hasText: 'surname starts with' }).locator('b');
    await expect(prefix).toHaveText('1 shard');                       // range is the default
    await root.getByRole('button', { name: /By hash of ID/ }).click();
    await expect(prefix).toContainText('scatter-gather');
    await root.getByRole('button', { name: /Lookup table/ }).click();
    await expect(prefix).toContainText('scatter-gather');
  });

  test('a lookup table evens out traffic that hashing leaves lopsided', async ({ page }) => {
    await page.goto('labs/sharding/');
    const root = page.locator('.v-sharding');
    await root.locator('#s-n-in').fill('6');
    const factor = async () => parseFloat((await root.locator('#s-verdict').textContent())!.match(/handles ([\d.]+)×/)![1]);
    await root.getByRole('button', { name: /By hash of ID/ }).click();
    const hash = await factor();
    await root.getByRole('button', { name: /Lookup table/ }).click();
    expect(await factor()).toBeLessThan(hash);
  });
});

test.describe('message queue', () => {
  test('a producer faster than the consumers drops messages; back pressure prevents it', async ({ page }) => {
    await page.clock.install();
    await page.goto('labs/message-queue/');
    const root = page.locator('.v-queue');
    const dropped = root.locator('#q-stats > div', { hasText: 'Dropped' }).locator('dd');
    await expect(dropped).toBeVisible(); // the widget loads lazily; wait for it before moving the fake clock
    await page.clock.runFor(8_000);
    expect(Number(await dropped.textContent())).toBeGreaterThan(0);

    await root.getByRole('button', { name: 'Reset' }).click();
    await root.locator('#q-bp').check();
    await page.clock.runFor(8_000);
    await expect(dropped).toHaveText('0');
    await expect(root.locator('#q-verdict')).toContainText('back pressure');
  });

  test('can be paused with the keyboard', async ({ page }) => {
    await page.goto('labs/message-queue/');
    const play = page.locator('.v-queue #q-play');
    await play.focus();
    await page.keyboard.press('Enter');
    await expect(play).toHaveText('Play');
  });
});

test.describe('DNS', () => {
  test('a cold lookup walks every step; a resolver cache short-circuits it', async ({ page }) => {
    await page.clock.install();
    await page.goto('labs/dns-resolution/');
    const root = page.locator('.v-dns');
    await root.getByRole('button', { name: /Look up/ }).click();
    await page.clock.runFor(6_000);
    await expect(root.locator('#d-verdict')).toContainText('Total: 111 ms');

    await root.getByLabel('Resolver has it cached').check();
    await root.getByRole('button', { name: /Look up/ }).click();
    await page.clock.runFor(6_000);
    await expect(root.locator('#d-verdict')).toContainText('Total: 21 ms');
    await expect(root.locator('#d-verdict')).toContainText('resolver cache');
  });
});

test.describe('CDN', () => {
  test('a pull CDN is slow on the first request and fast on the second', async ({ page }) => {
    await page.goto('labs/cdn/');
    const root = page.locator('.v-cdn');
    await root.getByRole('button', { name: 'Europe' }).click();
    await expect(root.locator('#c-verdict')).toContainText('135 ms');
    await root.getByRole('button', { name: 'Europe' }).click();
    await expect(root.locator('#c-verdict')).toContainText('served by the edge in 15 ms');
  });

  test('a copy expires after its TTL', async ({ page }) => {
    await page.goto('labs/cdn/');
    const root = page.locator('.v-cdn');
    await root.getByRole('button', { name: 'Asia' }).click();
    for (let i = 0; i < 4; i++) await root.getByRole('button', { name: 'Let a tick pass' }).click();
    await root.getByRole('button', { name: 'Asia' }).click();
    await expect(root.locator('#c-verdict')).toContainText('expired');
  });

  test('a push CDN is warm everywhere until purged', async ({ page }) => {
    await page.goto('labs/cdn/');
    const root = page.locator('.v-cdn');
    await root.getByRole('button', { name: /Push CDN/ }).click();
    await root.getByRole('button', { name: 'Asia' }).click();
    await expect(root.locator('#c-verdict')).toContainText('15 ms');
    await root.getByRole('button', { name: 'Purge the edges' }).click();
    await root.getByRole('button', { name: 'Asia' }).click();
    await expect(root.locator('#c-verdict')).toContainText('origin');
  });
});

test.describe('TCP and UDP', () => {
  test('with no loss both deliver everything; with loss UDP leaves gaps and TCP does not', async ({ page }) => {
    await page.goto('labs/tcp-udp/');
    const root = page.locator('.v-tcp');
    await root.locator('#t-loss-in').fill('0');
    await expect(root.locator('#t-verdict')).toContainText('both deliver everything');
    await root.locator('#t-loss-in').fill('30');
    await expect(root.locator('#t-verdict')).toContainText('TCP delivered all 16 in order');
    await expect(root.locator('#t-stats > div', { hasText: 'TCP delivered' }).locator('dd')).toHaveText('16 of 16');
    const udp = await root.locator('#t-stats > div', { hasText: 'UDP delivered' }).locator('dd').textContent();
    expect(parseInt(udp!, 10)).toBeLessThan(16);
  });
});

test.describe('load curve', () => {
  test('adding servers lowers utilisation and response time', async ({ page }) => {
    await page.goto('labs/load-curve/');
    const root = page.locator('.v-curve');
    await expect(root.locator('#l-stats')).toContainText('75% busy');
    await root.locator('#l-n-in').fill('16');
    await expect(root.locator('#l-stats')).toContainText('38% busy');
  });

  test('demand beyond capacity is reported as unbounded', async ({ page }) => {
    await page.goto('labs/load-curve/');
    const root = page.locator('.v-curve');
    await root.locator('#l-n-in').fill('2');
    await expect(root.locator('#l-verdict')).toContainText('grows without limit');
  });
});

test('topic pages link to their interactive visuals', async ({ page }) => {
  for (const [path, lab] of [['learn/dns/', 'labs/dns-resolution/'], ['learn/cdn/', 'labs/cdn/'], ['learn/database/', 'labs/replication/'], ['learn/asynchronism/', 'labs/message-queue/'], ['learn/communication/', 'labs/tcp-udp/'], ['learn/latency-vs-throughput/', 'labs/load-curve/']]) {
    await page.goto(path);
    await expect(page.locator(`.try-it a[href$="${lab}"]`), `${path} -> ${lab}`).toBeVisible();
  }
});
