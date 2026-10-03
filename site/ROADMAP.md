# Roadmap

What is built, and a detailed plan for the larger features that are not. Effort is in focused working days for one person who already knows this codebase.

## Where things stand

| Area | Status |
|---|---|
| README and solutions rendered as a site, search, dark mode, mobile layout | Done |
| Interactive tools: study planner, latency explorer, powers of two, availability calculator | Done |
| Flashcards from the Anki deck, direct deck downloads | Done |
| Labs: capacity estimator, consistent hashing, cache eviction, load balancing, CAP | Done |
| Hygiene: strict build, sitemap, share image, CI on pull requests, Dependabot, weekly external-link report | Done |

## Principles for everything below

1. **Static and private.** No accounts, no server, no analytics. All state lives in the browser and can be exported.
2. **The README stays upstream's.** New content is original and lives in `site/content/`, clearly labelled, so pulling upstream changes never conflicts with it.
3. **Progressive enhancement.** Every page must read fine with JavaScript off. Features add to the page; they never gate it.
4. **Mobile and keyboard first.** Each feature ships with a phone layout and full keyboard operation, or it does not ship.
5. **Small bundles.** Features load only on the pages that use them (the pattern already used for labs).

---

## 0. Foundation: one progress store (do this first)

Features 1 to 3 all need to remember things. Today the planner, flashcards, theme and diagram choice each write their own `localStorage` key. Unify them before adding more.

**Goal.** A single, versioned, exportable store that every feature reads and writes.

**Design.**
- New module `src/lib/progress.ts`, one key: `primer:v1`, holding one JSON document:

  ```json
  {
    "version": 1,
    "read":      { "learn/cache/": { "at": 1760000000000, "pct": 100 } },
    "plan":      { "last": "medium", "done": { "short": [0, 2] } },
    "cards":     { "known": ["Cache-aside"], "seen": { "Cache-aside": 3 } },
    "quiz":      { "attempts": [{ "id": "cache", "score": 4, "of": 5, "at": 1760000000000 }] },
    "solutions": { "practice/system-design/pastebin/": { "status": "done", "notes": "" } },
    "sessions":  [{ "id": "…", "question": "…", "minutes": 42, "notes": "…", "at": 1760000000000 }]
  }
  ```
- API: `get()`, `update(fn)`, `subscribe(cb)`, `exportJson()`, `importJson(text)`, `reset(section?)`. Writes are debounced; `subscribe` also listens to the `storage` event so two tabs stay in sync.
- One-time migration from the existing keys (`primer:plan:v1`, `primer:cards:v1`, `theme`, `diagrams`) with a version field for future migrations.
- Everything wrapped in try/catch: private mode and blocked storage must degrade to in-memory state, not errors.

**Steps.** (1) write the module and unit tests, (2) port planner and flashcards onto it, (3) add an "Your data" panel on the About page with Export, Import and Reset.

**Acceptance.** Existing planner and flashcard progress survives the migration; export then import on a fresh browser reproduces the same state; storage disabled does not break any page.

**Effort.** 1 day. **Risk.** Low. The only trap is silently overwriting good data on a failed parse, so import must validate and keep a backup of the previous document.

---

## 1. Progress dashboard

**Goal.** Answer "what have I covered, and what should I do next?" without hunting.

**User flow.**
1. Reading a topic to the end marks it read. A small check appears next to it in the sidebar.
2. Solutions have a manual status: not started, attempted, done.
3. A `/progress/` page shows rings per group (Fundamentals 3 of 5, and so on), the flashcard mastery, planner completion for the chosen timeline, and a "Next up" card.

**Design.**
- **Read detection.** Reuse the reading-progress bar logic: mark read when the article's bottom has been in view and at least 40% of the estimated reading time has passed (prevents jump-to-end). Store `pct` so partial reads show as half-filled dots.
- **Sidebar.** A dot before each link: empty, half, filled. Solutions show a different glyph for attempted vs done. Must have a text alternative (`aria-label="Read"`), not colour alone.
- **Next up.** Deterministic: the first unread topic in the reading trail; if the planner has a timeline, prefer unchecked planner items; if all topics are read, the first solution not marked done.
- **Dashboard.** Server-render the structure (groups and page lists) from `site.json`; hydrate rings and statuses from the store. A "Reset progress" control scoped per section.

**Files.** `src/pages/progress.astro`, `src/scripts/progress-ui.ts`, small changes to `Sidebar.astro` and `ui.ts`.

**Edge cases.** Pages renamed upstream (a stored path no longer exists: ignore it, do not count it); very short pages; users who read on two devices (no sync by design, export/import covers it).

**Acceptance.** Reading three topics changes the dashboard and the sidebar immediately in another open tab; clearing progress clears both; works with JS disabled as a plain index with no marks.

**Effort.** 2 days. **Depends on.** Foundation.

---

## 2. Quiz mode

**Goal.** Active recall beyond flashcards: short multiple-choice questions per topic with explanations that link back to the text.

**Content model.** Questions are authored, not generated, in `site/content/quizzes/<topic-slug>.yaml`:

```yaml
topic: learn/cache/
questions:
  - id: cache-aside-miss
    q: In cache-aside, who loads data into the cache after a miss?
    choices:
      - The cache itself
      - The application
      - The database
      - A background worker
    answer: 1
    why: The application reads storage and populates the cache; the cache never talks to storage itself.
    link: "#cache-aside"
    difficulty: 1
```

- 5 to 8 questions per topic for the 16 topic pages, about 100 in total. I can draft them; a human must review every answer, because a wrong quiz is worse than none.
- Build-time validation in `build-content.mjs`: exactly one correct index, every `link` anchor resolves (reusing the anchor map), no duplicate ids. Failures are fatal in strict mode.

**User flow.**
1. Each topic page ends with "Test yourself (6 questions)".
2. A quiz runs in place: one question at a time, immediate feedback with the explanation and a link to the exact section, a score at the end.
3. Missed questions feed a "Review" list; the progress dashboard shows per-topic scores and the weakest topics.
4. A mixed quiz on `/quiz/` draws from topics you have read, weighted toward the ones you missed.

**Design details.** Shuffle choices with a seeded RNG so a refresh does not reshuffle mid-question; keyboard: 1 to 4 to answer, Enter for next; announce correctness through `aria-live`; never reveal the answer in the DOM before answering (the data is in the page, so this is honesty, not security).

**Scoring.** Plain percentage plus a simple spaced-repetition rule: a missed question returns after 1 day, then 3, then 7. Store `due` timestamps in the progress store. Do not build a full SM-2 scheduler until there is evidence people use the basic one.

**Files.** `content/quizzes/*.yaml`, `scripts/quizzes.mjs` (parse and validate), `src/scripts/quiz.ts`, `src/pages/quiz.astro`, a `Quiz` mount on topic pages.

**Acceptance.** All quizzes validate in CI; every explanation link lands on a real heading; a full run works by keyboard only on a phone; scores persist and export.

**Effort.** 3 days of engineering plus about 2 days of question review. **Risk.** Content quality is the whole risk, so budget the review time and add a "Report a problem with this question" link that opens a prefilled GitHub issue.

---

## 3. Mock-interview session

**Goal.** Practise the actual format: a timed conversation that follows the four steps, with a place to think and a way to review afterwards.

**User flow.**
1. Pick a question (from the solved set or the "more questions" list) and a length (30, 45 or 60 minutes).
2. The session screen shows a timer split by phase, a notes area per step, and the checklist from the approach page.
3. Phases follow the README's four steps with suggested time shares: requirements 15%, high-level design 25%, deep dive 40%, scaling 20%. The timer shows the current phase and gives a gentle cue when a phase runs over; it never forces a move.
4. At the end: a review screen with the notes laid out, the time spent per phase, a link to the reference solution, and a short self-assessment (did you state assumptions? calculate load? name trade-offs?).
5. Sessions are saved to the store, listed on the dashboard, and exportable as Markdown.

**Design details.**
- **Timer correctness.** Compute elapsed time from timestamps, not by counting ticks, so a throttled background tab or a sleeping laptop does not drift. Pause and resume are explicit.
- **Notes.** Plain textarea per phase, autosaved every few seconds. Offer a scratch area with the capacity estimator one click away (it opens in a side panel and can paste its numbers into the notes).
- **Hiding the solution.** The reference solution link stays disabled until the session ends, with an explicit "End early" button.
- **Accessibility.** The timer is announced only at phase boundaries, not every second.

**Files.** `src/pages/practice/mock.astro`, `src/scripts/mock.ts`, a Markdown export helper.

**Acceptance.** Closing the tab mid-session and reopening resumes with the correct elapsed time; the export contains every note; nothing leaves the browser.

**Effort.** 3 days. **Depends on.** Foundation; benefits from the estimator being embeddable (a small refactor of `labs.ts` to export the estimator as a function).

---

## 4. Offline reading (installable app)

**Goal.** Read the guide on a plane, and install it on a phone home screen.

**Design.**
- **Web manifest** (`manifest.webmanifest`) with name, theme colours, icons (192, 512 and a maskable variant), `display: standalone`, `start_url` respecting the base path.
- **Service worker** (hand-written, about 80 lines, no build plugin):
  - Precache the shell: CSS, JS, fonts, the search index and the home page.
  - Runtime cache for pages and images with stale-while-revalidate, so reading online always converges to the newest content.
  - Cache the Pagefind index lazily on first search so offline search works after one online use.
  - Versioned cache names; delete old caches on activate.
  - **Never cache the service worker file itself or a 404 response.**
- **Update flow.** When a new version is waiting, show a non-blocking "Update available, reload" toast. Never auto-reload while someone is typing in a note or mid-quiz.
- **Opt-in storage.** A button "Make available offline" prefetches every page (about 15 MB including diagrams) with a progress bar, rather than silently downloading everything.

**Pitfalls to design around.** GitHub Pages serves under a sub-path, so scope and `start_url` must use the base; hashed asset names change per build, so the precache list must be generated at build time (emit a `precache.json` from the build); iOS storage eviction means offline is best effort and the UI should say so.

**Acceptance.** Lighthouse PWA checks pass; with the network disabled after "Make available offline", every page, the search and the labs work; a deploy with changed content shows the update toast and then serves the new version.

**Effort.** 2 days. **Risk.** Medium: stale-cache bugs are the classic failure, so test the update path explicitly before shipping.

---

## 5. More original content

**Goal.** Fill the gaps the README itself lists as "under development" and a few that interviews commonly probe. The upstream README stays untouched; additions go in `site/content/` and are marked.

**Candidates, in priority order.**
1. **Consistent hashing** (written up properly to sit beside the lab), **scatter-gather**, and **MapReduce**: the three upstream lists as unfinished.
2. **Rate limiting** (token bucket, leaky bucket, sliding window; with a lab), because it appears constantly as an interview question.
3. **Unique ID generation** (Snowflake-style, UUID trade-offs), **idempotency** and retries, **pagination** (offset vs cursor).
4. **Observability** basics (logs, metrics, traces, SLOs), which the README does not cover.
5. Two more worked solutions that the "more questions" table only links out for: a rate limiter and a notification system.

**Structure.** A new group, "Additions", in the sidebar, each page using the existing format: summary, how it works, trade-offs (rendered as the amber callout via the same heading convention), further reading. A visible badge "Original to this site" and a license note; decide the license for original text explicitly (CC BY 4.0 would match upstream and keep reuse simple).

**Process.** Draft, then human technical review before merge; sources cited; diagrams drawn as inline SVG so they theme with dark mode (no more white PNG cards for new content).

**Effort.** About 1 day per page, plus review. **Risk.** Accuracy and tone drift from upstream; mitigate with the review step and a short style guide in `CONTRIBUTING`.

---

## Cross-cutting work

**Testing.**
- Unit tests (Vitest) for the pure logic that has already caused or could cause bugs: `resolveHref` and the anchor map, the cache simulators (known sequences with known hit rates), the load-balancer simulation determinism, the progress store migration and import validation.
- A small Playwright smoke suite in CI: home loads, search returns a hit, a lab renders, the drawer opens on a phone viewport, and no console errors on any page. The link checker already covers internal links.

**Accessibility.** Run axe on every page type in CI. Fix as found: focus management when dialogs open and close, `aria-live` regions in the labs, minimum 44px touch targets, `prefers-reduced-motion` honoured by the load-balancing animation and hero diagram (the animation is already paused for it; verify), and contrast checks in both themes.

**Performance budget.** Fail CI if the home page ships more than 150 KB of JavaScript or any lab more than 60 KB gzipped. Keep fonts subsetted (Latin only), and lazy-load diagrams (done).

**Upstream sync.** Add a documented routine: `git fetch upstream && git merge upstream/master`. Strict mode will fail the build if upstream renames a section; the fix is a one-line change in `scripts/site-map.mjs`. Note that deleting the translation files means upstream's translation changes will conflict; resolve by keeping the deletion.

**Observability of the site itself.** None by default (no analytics). If usage numbers are ever wanted, use a privacy-preserving, cookieless counter and say so on the About page.

## Suggested order

| Step | Work | Effort | Why this order |
|---|---|---|---|
| 1 | Foundation: progress store | 1 day | Everything else stores state |
| 2 | Progress dashboard | 2 days | Visible value from the store, low risk |
| 3 | Tests and accessibility pass | 2 days | Lock in quality before adding more |
| 4 | Quiz mode (plus question review) | 3 + 2 days | Biggest learning payoff |
| 5 | Mock-interview session | 3 days | Builds on estimator and store |
| 6 | Offline / installable | 2 days | Last, because caching raises the cost of every later mistake |
| 7 | Original content, continuous | 1 day per page | Runs in parallel from step 3 |

Total engineering: about 13 days, plus content review.

## Things deliberately not planned

- **User accounts, cloud sync, comments.** They need a backend and moderation for small benefit; export and import cover moving between devices.
- **Translations.** The project is English only by decision.
- **AI-generated answers or an in-page chatbot.** The value of this site is that every claim traces to a reviewed source.
- **A full spaced-repetition engine.** Anki already does this well, and the decks download directly.
