import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const KEY = 'primer:v1';
const DAY = 86_400_000;

async function seed(page: Page, doc: Record<string, unknown>) {
  await page.addInitScript((d) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('primer:v1', JSON.stringify(d));
  }, { version: 1, ...doc });
}
const doc = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);

interface QuizFile { questions: { q: string; choices: string[]; answer: number }[] }
async function correctAnswers(page: Page, slug: string): Promise<Map<string, string>> {
  const res = await page.request.get(`data/quiz/${slug}.json`);
  const file = (await res.json()) as QuizFile;
  return new Map(file.questions.map((q) => [q.q, q.choices[q.answer]]));
}

test.describe('topic quiz', () => {
  test('a full run scores correctly, saves the attempt, and schedules the miss for review', async ({ page }) => {
    const answers = await correctAnswers(page, 'cache');
    await page.goto('learn/cache/');
    const quiz = page.locator('.widget.quiz');
    await quiz.scrollIntoViewIfNeeded();
    await expect(quiz.getByRole('heading', { name: /6 questions on Cache/ })).toBeVisible();
    await quiz.getByRole('button', { name: 'Start the quiz' }).click();

    let wrongId = '';
    for (let i = 0; i < 6; i++) {
      const text = (await quiz.locator('.quiz-q').textContent())!.trim();
      const right = answers.get(text)!;
      const choices = quiz.locator('.quiz-choice');
      if (i === 2) { // answer one wrongly on purpose
        wrongId = text;
        const wrong = choices.filter({ hasNotText: right }).first();
        await wrong.click();
        await expect(quiz.locator('.quiz-explain')).toContainText('Not quite');
      } else {
        await choices.filter({ hasText: right }).first().click();
        await expect(quiz.locator('.quiz-explain')).toContainText('Correct');
      }
      await expect(quiz.locator('.quiz-explain a')).toHaveAttribute('href', /learn\/cache\//);
      await quiz.getByRole('button', { name: /Next question|See results/ }).click();
    }
    await expect(quiz.locator('.quiz-score')).toContainText('5 of 6');
    expect(wrongId).not.toBe('');
    await expect(quiz.locator('.quiz-review li.bad')).toHaveCount(1);

    await expect.poll(async () => (await doc(page))?.quiz?.attempts?.length).toBe(1);
    const d = await doc(page);
    expect(d.quiz.attempts[0]).toMatchObject({ id: 'cache', score: 5, of: 6 });
    const items = Object.values(d.quiz.items) as { box: number; due: number }[];
    expect(items).toHaveLength(6);
    expect(items.filter((i) => i.box === 0)).toHaveLength(1);              // the miss is due now
    expect(items.filter((i) => i.box === 1 && i.due > Date.now())).toHaveLength(5); // the rest tomorrow
  });

  test('can be completed with the keyboard alone', async ({ page }) => {
    await page.goto('learn/database/');
    const quiz = page.locator('.widget.quiz');
    await quiz.scrollIntoViewIfNeeded();
    await quiz.getByRole('button', { name: 'Start the quiz' }).focus();
    await page.keyboard.press('Enter');
    for (let i = 0; i < 6; i++) {
      await expect(quiz.locator('.quiz-count')).toContainText(`Question ${i + 1} of 6`);
      await page.keyboard.press('1');                       // choose
      await expect(quiz.locator('.quiz-explain')).toBeVisible();
      await page.keyboard.press('Enter');                   // next
    }
    await expect(quiz.locator('.quiz-score')).toBeVisible();
  });

  test('does not reveal which answer is right before answering', async ({ page }) => {
    await page.goto('learn/load-balancer/');
    const quiz = page.locator('.widget.quiz');
    await quiz.getByRole('button', { name: 'Start the quiz' }).click();
    await expect(quiz.locator('.is-correct, .is-wrong, .quiz-flag, .quiz-explain')).toHaveCount(0);
  });

  test('resumes where you left off after a reload', async ({ page }) => {
    await page.goto('learn/cache/');
    const quiz = page.locator('.widget.quiz');
    await quiz.getByRole('button', { name: 'Start the quiz' }).click();
    for (let i = 0; i < 2; i++) { await page.keyboard.press('1'); await page.keyboard.press('Enter'); }
    await expect(quiz.locator('.quiz-count')).toContainText('Question 3 of 6');
    await page.reload();
    await expect(page.locator('.widget.quiz .quiz-count')).toContainText('Question 3 of 6');
  });

  test('flags unreviewed questions as drafts', async ({ page }) => {
    await page.goto('learn/cache/');
    await expect(page.locator('.widget.quiz .quiz-draft')).toContainText('Draft');
  });

  test('every shipped question has one correct answer that is present in the file', async ({ page }) => {
    const index = (await (await page.request.get('data/quiz/index.json')).json()) as { slug: string }[];
    expect(index.length).toBeGreaterThanOrEqual(3);
    for (const { slug } of index) {
      const file = (await (await page.request.get(`data/quiz/${slug}.json`)).json()) as QuizFile;
      for (const q of file.questions) expect(q.answer).toBeLessThan(q.choices.length);
    }
  });
});

test.describe('mixed quiz', () => {
  test('asks the due question first and offers the requested number', async ({ page }) => {
    await seed(page, {
      quiz: { attempts: [], items: { 'lb-ssl-termination': { box: 0, due: Date.now() - DAY, seen: 1, lapses: 1 } } },
    });
    await page.goto('quiz/');
    const quiz = page.locator('.widget.quiz');
    await expect(quiz).toContainText('1 due for review');
    await quiz.locator('#quiz-count').selectOption('5');
    await quiz.getByRole('button', { name: 'Start' }).click();
    await expect(quiz.locator('.quiz-count')).toContainText('Question 1 of 5');
    // the due question must appear somewhere in the five
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) { seen.push((await quiz.locator('.quiz-q').textContent())!); await page.keyboard.press('1'); await page.keyboard.press('Enter'); }
    expect(seen.join('\n')).toContain('SSL termination');
  });
});

test.describe('progress dashboard', () => {
  test('a new learner is sent to the first topic', async ({ page }) => {
    await page.goto('progress/');
    await expect(page.locator('.prog-next')).toContainText('A good place to start');
    await expect(page.locator('.prog-next a')).toHaveAttribute('href', /learn\/start-here\//);
  });

  test('due flashcards take priority, then it moves along as topics are read', async ({ page }) => {
    await seed(page, { cards: { 'Cache-aside': { box: 1, due: Date.now() - 1000, seen: 2, lapses: 0 } } });
    await page.goto('progress/');
    await expect(page.locator('.prog-next h2')).toHaveText('Review your flashcards');

    const page2 = await page.context().newPage();
    await seed(page2, { read: { 'learn/start-here/': { at: Date.now(), pct: 100 } } });
    await page2.goto('progress/');
    await expect(page2.locator('.prog-next a')).toHaveAttribute('href', /interview\/study-guide\//);
  });

  test('shows reading counts per group and a weak quiz topic', async ({ page }) => {
    await seed(page, {
      read: { 'learn/performance-vs-scalability/': { at: Date.now(), pct: 100 }, 'learn/latency-vs-throughput/': { at: Date.now(), pct: 100 } },
      quiz: { attempts: [{ id: 'cache', score: 2, of: 6, at: Date.now() }], items: {} },
    });
    await page.goto('progress/');
    await expect(page.locator('.prog-ring.group-fundamentals svg')).toHaveAttribute('aria-label', 'Fundamentals: 2 of 5');
    await expect(page.locator('.prog-list li.weak')).toContainText('Cache');
  });

  test('sidebar marks show read, partly read and attempted pages (and have text alternatives)', async ({ page, isMobile }) => {
    await seed(page, {
      read: { 'learn/dns/': { at: Date.now(), pct: 100 }, 'learn/cdn/': { at: Date.now(), pct: 40 } },
      solutions: { 'practice/system-design/pastebin/': { status: 'attempted' } },
    });
    await page.goto('learn/cache/');
    if (isMobile) await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.locator('.nav-link[data-path="learn/dns/"]')).toHaveAttribute('data-state', 'read');
    await expect(page.locator('.nav-link[data-path="learn/cdn/"]')).toHaveAttribute('data-state', 'partial');
    await expect(page.locator('.nav-link[data-path="learn/dns/"] .sr-only')).toHaveText(/read/);
    await expect(page.locator('.nav-link[data-path="practice/system-design/pastebin/"]')).toHaveAttribute('data-state', 'attempted');
  });
});

test.describe('solution status', () => {
  test('can be set, persists, and shows in the navigation', async ({ page, isMobile }) => {
    await page.goto('practice/system-design/pastebin/');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await doc(page))?.solutions?.['practice/system-design/pastebin/']?.status).toBe('done');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveAttribute('aria-pressed', 'true');
    if (isMobile) await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.locator('.nav-link[data-path="practice/system-design/pastebin/"]')).toHaveAttribute('data-state', 'done');
    if (isMobile) await page.keyboard.press('Escape'); // close the drawer before using the page behind it
    await page.getByRole('button', { name: 'Not started' }).click();
    await expect.poll(async () => (await doc(page))?.solutions?.['practice/system-design/pastebin/']).toBeUndefined();
  });
});

test.describe('read tracking', () => {
  test('a page counts as read only after reaching the end and spending enough time', async ({ page }) => {
    await page.clock.install();
    await page.goto('learn/dns/'); // a one minute page: needs about 24 seconds
    await page.clock.runFor(60_000);                     // time passes, but the end was never reached
    await page.waitForTimeout(100);
    expect((await doc(page))?.read?.['learn/dns/']?.pct ?? 0).toBeLessThan(100);

    await page.locator('.pager').scrollIntoViewIfNeeded(); // reach the end
    await page.waitForTimeout(100);
    await page.clock.runFor(60_000);
    await expect.poll(async () => (await doc(page))?.read?.['learn/dns/']?.pct).toBe(100);
  });

  test('scrolling to the bottom straight away does not count', async ({ page }) => {
    await page.clock.install();
    await page.goto('learn/dns/');
    await page.locator('.pager').scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    await page.clock.runFor(4_000);
    await page.waitForTimeout(200);
    expect((await doc(page))?.read?.['learn/dns/']?.pct ?? 0).toBeLessThan(100);
  });
});

test.describe('accessibility of interactive states', () => {
  for (const theme of ['light', 'dark']) {
    test(`quiz, flashcard and dashboard states pass axe in the ${theme} theme`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
      const check = async (label: string) => {
        const { violations } = await new AxeBuilder({ page }).analyze();
        const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(bad.map((v) => `${label}: ${v.id} ${v.nodes[0]?.target.join(' ')}`), label).toEqual([]);
      };

      await page.goto('learn/cache/');
      const quiz = page.locator('.widget.quiz');
      await quiz.getByRole('button', { name: 'Start the quiz' }).click();
      await check('quiz question');
      await page.keyboard.press('1');
      await check('quiz feedback');
      for (let i = 0; i < 6; i++) { if (i > 0) await page.keyboard.press('1'); await page.keyboard.press('Enter'); }
      await expect(quiz.locator('.quiz-score')).toBeVisible();
      await check('quiz results');

      await page.goto('practice/flashcards/');
      await page.getByRole('button', { name: /Show answer/ }).click();
      await check('flashcard answer');

      await page.goto('progress/');
      await expect(page.locator('.prog-next')).toBeVisible();
      await check('dashboard');
    });
  }
});
