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
    await expect(root.locator('#q-verdict')).toContainText(/back pressure/i);
    await expect(root.locator('#q-stats > div', { hasText: 'Waiting at the producer' }).locator('dd')).not.toHaveText('0');
  });

  test('can be paused with the keyboard, and stepped one tick at a time', async ({ page }) => {
    await page.goto('labs/message-queue/');
    const play = page.locator('.v-queue .player [data-pl="toggle"]');
    await expect(play).toHaveText('Pause');
    await play.focus();
    await page.keyboard.press('Enter');
    await expect(play).toHaveText('Play');
    const delivered = page.locator('.v-queue #q-stats > div', { hasText: 'Delivered' }).locator('dd');
    const before = Number(await delivered.textContent());
    await page.keyboard.press('ArrowRight');
    await expect(delivered).not.toHaveText(String(before));
    await expect(page.locator('.v-queue .player-status')).toContainText('Tick');
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

test.describe('lab additions', () => {
  test('quorum: W = 1, R = 1 reads stale data; W = 2, R = 2 does not', async ({ page }) => {
    await page.goto('labs/quorum/');
    const w = page.locator('.v-quorum');
    await w.getByRole('button', { name: 'Write' }).click();
    await w.getByRole('button', { name: 'Read', exact: true }).click();
    await expect(w.locator('#q-msg')).toContainText('current');
    await w.locator('#q-w-in').fill('1');
    await w.locator('#q-r-in').fill('1');
    await w.getByRole('button', { name: 'Write' }).click();
    await w.getByRole('button', { name: 'Read', exact: true }).click();
    await expect(w.locator('#q-msg')).toContainText('STALE');
  });

  test('DNS TTL: a cached answer outlives a record change until it expires', async ({ page }) => {
    await page.goto('labs/dns-resolution/');
    const w = page.locator('.v-ttl');
    await w.getByRole('button', { name: 'A user looks it up' }).click();
    await w.getByRole('button', { name: 'Point it at the new server' }).click();
    await w.getByRole('button', { name: '1 hour passes' }).click();
    await w.getByRole('button', { name: 'A user looks it up' }).click();
    await expect(w.locator('#t-log li').first()).toContainText('no longer the right one');
    await w.getByRole('button', { name: '1 day passes' }).click();
    await w.getByRole('button', { name: 'A user looks it up' }).click();
    await expect(w.locator('#t-log li').first()).toContainText('new server');
  });

  test('replication: read-your-writes sends a writer\'s read to the primary', async ({ page }) => {
    await page.goto('labs/replication/');
    const w = page.locator('.v-repl');
    await w.getByLabel(/Read your own writes/).check();
    await w.getByRole('button', { name: 'Write', exact: true }).click();
    await w.getByRole('button', { name: 'Read through the load balancer' }).click();
    await expect(w.locator('#r-status')).toContainText('sent this read to the primary');
  });
});

test.describe('rate limiting', () => {
  test('a fixed window lets twice the limit through at a boundary; a sliding log does not', async ({ page }) => {
    await page.goto('labs/rate-limiting/');
    const w = page.locator('.v-rate');
    // the comparison table is computed from the whole run, so it can be checked without waiting for playback
    await expect(w.locator('[data-row="fixed-window"] td').nth(3)).toHaveText('20 / 10');
    await expect(w.locator('[data-row="fixed-window"] td').nth(3)).toHaveClass(/bad/);
    await expect(w.locator('[data-row="sliding-log"] td').nth(3)).toHaveText('10 / 10');
    await w.locator('.player [data-pl="toggle"]').click(); // pause, then play to the end one step at a time
    for (let i = 0; i < 100; i++) await w.locator('.player [data-pl="step"]').click();
    await expect(w.locator('#rl-verdict')).toContainText('20 requests through in one second, 2 times the limit');
    await w.getByRole('button', { name: /Sliding log/ }).click();
    await expect(w.locator('#rl-verdict')).toContainText('never served more than 10');
  });

  test('only the bucket limiters show a bucket size, and only the leaky bucket makes requests wait', async ({ page }) => {
    await page.goto('labs/rate-limiting/');
    const w = page.locator('.v-rate');
    await expect(w.locator('#rl-b-wrap')).toBeHidden();
    await w.getByRole('button', { name: /Leaky bucket/ }).click();
    await expect(w.locator('#rl-b-wrap')).toBeVisible();
    await expect(w.locator('#rl-b-name')).toHaveText('Queue holds');
    for (const a of ['fixed-window', 'sliding-log', 'sliding-counter', 'token-bucket']) await expect(w.locator(`[data-row="${a}"] td`).nth(4)).toHaveText('none');
    await expect(w.locator('[data-row="leaky-bucket"] td').nth(4)).not.toHaveText('none');
  });
});
