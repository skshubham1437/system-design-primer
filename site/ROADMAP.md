# Roadmap

What is built, and what comes next. The goal of the next stage is simple: turn a good **reader** into a good **learning tool**. How the work gets done (tasks, order, tests, gates) is in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

Effort is in focused working days for one person who knows this codebase. Content review time is listed separately because it is the real bottleneck.

## Where things stand

| Area | Status |
|---|---|
| README and solutions rendered as a site, search, dark mode, mobile layout | Done |
| Interactive tools: study planner, latency explorer, powers of two, availability calculator | Done |
| Flashcards from the Anki deck (known / review again), direct deck downloads | Done |
| Labs: capacity estimator, consistent hashing, cache eviction, load balancing, CAP | Done |
| Hygiene: strict build, sitemap, share image, CI on pull requests, Dependabot, weekly external-link report | Done |
| Tests: 67 unit tests, end-to-end and accessibility checks on every page at desktop and phone width, run in CI | Done |
| Progress store, spaced flashcards, "your data" export/import, due badge (items 0 and 1 below) | Done |

### Known gaps

- Reading is passive. Nothing asks you to recall, predict or write anything except the labs and flashcards.
- Flashcards do not schedule reviews, so they help less than they could.
- Topics are an unordered map. A beginner has no route through them, and no prerequisites are shown.
- Solutions are long walls of text, and the reference answer is visible before you have tried.
- Several topics are thin (DNS, Security, Reverse proxy) and common interview topics are missing (rate limiting, ID generation, idempotency, observability).
- The 50 or so "real-world architecture" entries are bare links, and many are probably dead.
- The weekly dead-link report has never run, and there are no automated tests beyond the link checker.

## Principles

1. **Static and private.** No accounts, no server, no analytics. All state lives in the browser and can be exported.
2. **The README stays upstream's.** New content is original and lives in `site/content/`, clearly labelled, so pulling upstream changes never conflicts with it.
3. **Progressive enhancement.** Every page reads fine with JavaScript off. Features add to the page; they never gate it.
4. **Mobile and keyboard first.** Each feature ships with a phone layout and full keyboard operation, or it does not ship.
5. **Small bundles.** Features load only on the pages that use them (the pattern already used for labs).
6. **Accuracy beats volume.** Every authored question, explanation and summary is reviewed by a person before it ships. A wrong answer is worse than no answer.

### Learning principles each feature is judged against

| Principle | What it means here | Features |
|---|---|---|
| Retrieval practice | Recalling beats rereading | Quizzes, flashcards, follow-up questions |
| Spacing | Review just before forgetting | Scheduled flashcards and missed quiz questions |
| Generation | Attempt before seeing the answer | "Try it first" solutions, decision aids in predict mode, mock interviews |
| Dual coding | Pair words with pictures that move | Labs and interactive visuals |
| Worked examples, then fading | See one done, then do one yourself | Solutions in read mode, then practice mode |
| Feedback | Know what you got wrong and why | Explanations that link to the exact section, dashboard of weak topics |
| Structure | A route and the prerequisites | Guided path, "before this" chips |

---

## Priorities at a glance

| # | Item | Learning payoff | Effort |
|---|---|---|---|
| 0 | Foundation: one progress store and a scheduler | Enables everything | 1.5 days |
| 1 | Spaced flashcards | High | 1.5 days |
| 2 | Quizzes, piloted on three topics first | Highest | 3 days + review |
| 3 | Progress dashboard | Medium | 2 days |
| 4 | "Try it first" solutions and follow-up questions | High | 8 days + review |
| 5 | Guided path and prerequisites | High for beginners | 3.5 days |
| 6 | Decision aids | High for interviews | 4.5 days |
| 7 | Interactive visuals | Medium to high | 9 days |
| 8 | Glossary with hover definitions | Medium | 4 days |
| 9 | Real-world architecture summaries and link health | Medium | 6 days + review |
| 10 | Original content gaps | Medium | 1 day per page |
| 11 | Mock-interview session | Medium | 3 days |
| 12 | Offline and installable | Low for learning, high for convenience | 2 days |

---

## 0. Foundation: one progress store and a scheduler

Items 1 to 4, 6 and 11 all remember things. Today the planner, flashcards, theme and diagram choice each write their own `localStorage` key. Unify them first.

**Goal.** A single, versioned, exportable store plus one small spaced-repetition scheduler that flashcards and quizzes share.

**Design.**
- `src/lib/progress.ts`, one key `primer:v1`, one JSON document:

  ```json
  {
    "version": 1,
    "read":      { "learn/cache/": { "at": 1760000000000, "pct": 100 } },
    "plan":      { "last": "medium", "done": { "short": [0, 2] } },
    "cards":     { "Cache-aside": { "box": 2, "due": 1760086400000, "seen": 4, "lapses": 1 } },
    "quiz":      { "attempts": [{ "id": "cache", "score": 4, "of": 5, "at": 1760000000000 }],
                   "items": { "cache-aside-miss": { "box": 1, "due": 1760086400000 } } },
    "solutions": { "practice/system-design/pastebin/": { "status": "attempted", "notes": { "step-1": "…" } } },
    "paths":     { "scaling-story": { "stage": 4 } },
    "sessions":  [{ "id": "…", "question": "…", "minutes": 42, "notes": {}, "at": 1760000000000 }]
  }
  ```
- API: `get()`, `update(fn)`, `subscribe(cb)`, `exportJson()`, `importJson(text)`, `reset(section?)`. Writes are debounced; the `storage` event keeps two tabs in sync.
- `src/lib/srs.ts`: a Leitner scheduler with box 0 (new or relearning) and boxes 1 to 5, reviewed after 1, 3, 7, 21 and 60 days. Pure functions (`grade(item, result, now)`, `isDue(item, now)`, `nextDue`) so it is trivial to test. Day boundaries use local midnight.
- One-time migration from the existing keys, with a version field for later migrations.
- Everything in try/catch: private mode and blocked storage degrade to in-memory state, never an error page.

**Acceptance.** Existing planner and flashcard progress survives migration; export then import on a fresh browser reproduces the same state; invalid imports are rejected and the previous data is kept as a backup; storage disabled breaks nothing.

**Effort.** 1.5 days. **Risk.** Low. The trap is overwriting good data on a failed import.

---

## 1. Spaced flashcards

**Goal.** Turn "known / review again" into real scheduled review.

**User flow.** The deck page opens on "Due today (N)". Answer, then grade: **Again** (back to box 1, shown again this session), **Good** (up one box). Optional **Easy** jumps two boxes. New cards are introduced at 10 a day. A badge on the Flashcards link shows how many are due.

**Design details.**
- Existing "known" cards migrate to box 3, so nobody loses progress.
- A session summary shows cards seen, accuracy and when the next cards are due.
- Settings: new cards per day (5 / 10 / 20), and "show all cards" for free browsing.
- The Anki downloads stay, with a note that Anki's scheduler is more sophisticated for people who want it.

**Acceptance.** A card graded Good on day 0 reappears on day 1, then 3, then 7; Again resets it; a missed day does not punish the learner (overdue cards are simply due); clock changes do not corrupt state.

**Effort.** 1.5 days. **Depends on.** 0.

---

## 2. Quizzes

**Goal.** Active recall beyond flashcards: short multiple-choice questions per topic whose explanations link back to the exact section.

**Content model.** Authored, not generated, in `site/content/quizzes/<topic-slug>.yaml`:

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

- 5 to 8 questions for each of 16 topic pages, about 100 in total. A human reviews every answer.
- Prefer questions that test understanding over trivia: scenarios ("a cache node dies; what happens to latency?"), comparisons and "what would break if…".
- Build-time validation: exactly one correct index, every `link` anchor resolves, no duplicate ids, 3 to 5 choices. Failures are fatal in strict mode.

**Pilot first.** Ship Cache, Database and Load balancer only, and check that the format works, the explanations are good and learners actually use it, before writing the other ~85 questions.

**User flow.** Each topic page ends with "Test yourself (6 questions)". One question at a time, immediate feedback with the explanation and a link to the section, a score at the end. Missed questions enter the scheduler (item 0) and come back as a "Review" quiz. `/quiz/` offers a mixed quiz drawn from topics you have read, weighted toward misses.

**Details.** Seeded shuffle so a refresh does not reshuffle mid-question; keys 1 to 4 answer, Enter continues; correctness announced through `aria-live`; a "Report a problem with this question" link opens a prefilled GitHub issue.

**Acceptance.** All quizzes validate in CI; every explanation link lands on a real heading; a full run works by keyboard only on a phone; scores persist and export.

**Effort.** 3 days engineering, plus about 4 days of question drafting and review across all topics. **Risk.** Content quality is the whole risk, so the review time is not optional.

---

## 3. Progress dashboard

**Goal.** Answer "what have I covered, and what should I do next?".

**User flow.**
1. Reading a topic to the end marks it read; the sidebar shows empty, half and filled dots (with text alternatives, not colour alone).
2. Solutions have a status: not started, attempted, done.
3. `/progress/` shows a ring per group, flashcards due and mastered, quiz scores by topic with the weakest highlighted, and a **Next up** card.

**Design.**
- **Read detection.** Reuse the reading-progress logic; mark read when the end has been seen and at least 40% of the estimated reading time has elapsed, so jumping to the bottom does not count.
- **Next up** is deterministic: due flashcards first, then the weakest quiz topic, then the first unread topic in the reading trail, then the first solution not done.
- Pages renamed upstream are ignored rather than counted.

**Acceptance.** Reading three topics changes the dashboard and the sidebar immediately in another open tab; reset clears both; with JavaScript off the page is a plain index with no marks.

**Effort.** 2 days. **Depends on.** 0, 1, 2.

---

## 4. "Try it first" solutions and follow-up questions

**Goal.** Make the solutions a place to practise, not just read. Writing your own answer before seeing the reference is one of the most effective study techniques.

**Two modes on every solution.**
- **Read mode** (today's behaviour, the default for first-timers).
- **Practice mode.** Show the question and Step 1 only. The learner writes notes in a text box (saved locally), clicks **Reveal reference**, then ticks a short self-check rubric before moving on:

  ```yaml
  solution: pastebin
  steps:
    - id: step-1
      prompt: Which questions would you ask before designing anything?
      rubric:
        - I asked about the read to write ratio
        - I stated the expected traffic and data size
        - I said what is out of scope
  ```
- A summary at the end lists rubric items missed across steps.

**Follow-up questions ("Push it further").** Per solution, 4 to 6 hidden-answer prompts of the kind an interviewer asks next: "What breaks at 10× traffic?", "What if a region goes down?", "How would you add analytics without slowing reads?". Authored in the same YAML, rendered as collapsible items.

**Implementation notes.**
- The build already knows each solution's H2 steps; wrap each step in `<section data-step="…">`. Without JavaScript everything stays visible, so reading mode is unchanged.
- Rubrics and follow-ups are validated at build time (every solution has all four steps; ids unique).

**Acceptance.** Practice mode works by keyboard and on a phone; leaving mid-solution and returning restores the step and notes; the no-JS page is unchanged; rubric and follow-up content exists for all eight solutions.

**Effort.** 3 days for the engine, 3 days for rubrics, 2 days for follow-ups, plus review. Pilot on Pastebin first. **Depends on.** 0.

---

## 5. Guided path and prerequisites

**Goal.** Give beginners a route, and show what to know first.

**Guided path: "Scale a system from one user to millions".** A single interactive page that follows one product through its bottlenecks and mirrors the AWS scaling solution:

1. One server does everything.
2. Split web server and database.
3. Add DNS and a load balancer; make servers stateless.
4. Add a cache.
5. Replicate the database.
6. Put static content on a CDN.
7. Add queues for slow work.
8. Shard or move to NoSQL.
9. Go multi-region.

Each stage states the **symptom** that forces the change, the **fix**, the **trade-off** it introduces, and links to the topic and lab. The architecture diagram accumulates components as you advance. In practice mode each stage first asks "what would you add next?" with the answer hidden.

**Prerequisites.** A `PREREQS` map in `site-map.mjs`; each topic page shows "Before this: Load balancer, Cache". Strict mode fails if a prerequisite path does not exist or the graph has a cycle.

**Acceptance.** The path works without JavaScript as a numbered article; stage progress persists; every stage links to a real page.

**Effort.** 3 days for the path (including authored text and inline SVG), 0.5 day for prerequisites. **Depends on.** 0.

---

## 6. Decision aids

**Goal.** Interviews reward choosing and justifying. Practise that directly.

**Two modes per chooser.**
- **Guide me.** A short decision tree ends in a recommendation with the reasons and the trade-offs.
- **Test me.** Scenario cards ("A leaderboard updated 10,000 times a second and read constantly"). You pick first; the page then shows the best answer and why the others fall short.

**Choosers to build, in order:** SQL or NoSQL; which cache update pattern; which load-balancing algorithm; which consistency model; REST, RPC or messaging. Data-driven from `content/choosers/*.yaml`, validated at build time (every branch ends in an answer, no orphan nodes, links resolve).

**Acceptance.** Every scenario has one defensible best answer with written reasoning for the alternatives; works by keyboard; scenario results feed the dashboard.

**Effort.** 2 days for the engine, 0.5 day per chooser, plus review. Pilot with SQL or NoSQL. **Depends on.** 0.

---

## 7. Interactive visuals

**Goal.** Pair explanation with pictures that move. The five labs prove the approach; extend it to topics that are hard to picture.

| Visual | What the learner does | Priority |
|---|---|---|
| Database replication | Write to the primary, watch lag, read from a replica and see a stale value, kill the primary and fail over | 1 |
| Sharding | Compare range, hash and directory sharding; add a hot key and see one shard overloaded | 2 |
| Message queue and back pressure | Move the producer and consumer rates; watch the queue grow and see back pressure kick in | 3 |
| DNS resolution | Step through resolver, root, TLD and authoritative lookups; toggle cache hits and TTL | 4 |
| CDN push and pull | Request flow with cold and warm caches and TTL expiry | 5 |
| TCP and UDP | Handshake, then send packets over a lossy link and see retransmission versus loss | 6 |

A small shared "stepper" component (step controls, play/pause, reduced-motion support) keeps each visual to about a day and a half. New diagrams are inline SVG so they follow dark mode, replacing white-PNG cards.

**Acceptance.** Each visual is keyboard operable, readable on a phone, honours `prefers-reduced-motion`, and has a text description for screen readers.

**Effort.** 9 days in total (1.5 each). **Depends on.** the labs infrastructure that already exists.

---

## 8. Glossary with hover definitions

**Goal.** Stop learners leaving the page to look up quorum, idempotent, fan-out or back pressure.

**Design.**
- `content/glossary.yaml`: about 120 terms with a one or two sentence definition, aliases and a link to the best section.
- A build step wraps the **first occurrence per page** of each term in prose (never in code, headings or existing links). Whole-word matching, so "cache" does not match inside "cache-aside".
- Hover, focus and tap open a small popover (a button, not just `title`, so it works on touch and with screen readers). Tapping must not hijack link taps.
- `/glossary/` lists everything A to Z with filtering; the search palette includes terms.

**Acceptance.** No wrapped term inside a link or code block; popovers dismiss with Escape; every glossary link resolves; no layout shift when hydrated.

**Effort.** 2 days for the engine, 2 days for ~120 definitions, plus review.

---

## 9. Real-world architecture summaries and link health

**Goal.** Teach from the real systems instead of linking to 50 articles.

**Summaries.** Eight pages (Netflix, Twitter, Uber, Dropbox, Instagram, WhatsApp, YouTube, Facebook), each with: the problem, the key design decisions, headline numbers, lessons, and "what to borrow in an interview". Every claim cites a source; where the original is gone, cite an archived copy. Marked "Original to this site".

**Link health.** The weekly external-link workflow writes `site/data/link-status.json` through a bot pull request. At build time dead links in the README-derived pages are rewritten to an archived copy and marked, so learners stop hitting 404s. Fatal only if the status file is malformed.

**Acceptance.** Every number in a summary has a citation; no dead link on the summary pages; the build uses the status file and falls back safely when it is absent.

**Effort.** 4 days for summaries (0.5 each) and 2 days for link health, plus review.

---

## 10. Original content gaps

Written in `site/content/`, labelled as original, reviewed before merge. License for original text: CC BY 4.0, to match upstream.

1. **Rate limiting** (token bucket, leaky bucket, sliding window) with a lab, plus a worked solution.
2. **Unique ID generation** (Snowflake-style, UUID trade-offs).
3. **Idempotency and retries.**
4. **Pagination** (offset versus cursor).
5. **Observability** basics (logs, metrics, traces, SLOs).
6. **Consistent hashing, scatter-gather and MapReduce**, which upstream lists as unfinished.
7. Deepen the thin pages: DNS, Security, Reverse proxy.

**Effort.** About 1 day per page (1.5 for rate limiting with its lab), plus review.

---

## 11. Mock-interview session

**Goal.** Practise the actual format: a timed conversation following the four steps, with a place to think and a way to review.

**User flow.** Pick a question and a length (30, 45 or 60 minutes). The session shows phase timers (requirements 15%, high-level design 25%, deep dive 40%, scaling 20%), a notes area per phase, and the checklist from the approach page. A gentle cue appears when a phase runs over; it never forces a move. A review screen shows notes, time per phase, the reference solution (unlocked only at the end) and a self-assessment. Sessions are saved and exportable as Markdown.

**Details.** Elapsed time comes from timestamps, not tick counts, so a throttled tab or a sleeping laptop does not drift. The capacity estimator opens in a side panel and can paste its numbers into the notes. The timer is announced only at phase boundaries.

**Acceptance.** Closing the tab mid-session and reopening resumes with the correct time; the export contains every note; nothing leaves the browser.

**Effort.** 3 days. **Depends on.** 0, and a small refactor so the estimator can be embedded.

---

## 12. Offline and installable

**Goal.** Read on a plane; install on a phone home screen.

**Design.** Web manifest and icons (including a maskable one). A small hand-written service worker precaches the shell and caches pages and images with stale-while-revalidate, so online reading always converges to the newest content. Pagefind data is cached on first search. Versioned caches are cleaned on activate. A non-blocking "Update available" toast; never reload while someone is mid-quiz or typing notes. An opt-in "Make available offline" button prefetches everything (about 15 MB) with a progress bar.

**Pitfalls.** The site serves under a sub-path, so scope and `start_url` must use the base; hashed asset names change each build, so the precache list is generated at build time; iOS may evict storage, so offline is best effort and the UI says so.

**Acceptance.** Lighthouse PWA checks pass; with the network off after "Make available offline", every page, search and lab works; a deploy with changed content shows the update toast and then serves the new version.

**Effort.** 2 days. **Risk.** Medium; stale-cache bugs are the classic failure, so test the update path before shipping. Do this last.

---

## Cross-cutting work

**Testing.** Unit tests (Vitest) for pure logic that has caused or could cause bugs: link resolution and the anchor map, the cache and load-balancer simulators, the scheduler, the progress store migration and import validation, and every content validator. A small Playwright smoke suite in CI: pages load with no console errors, search returns a hit, a lab renders, the mobile drawer opens, a quiz can be completed by keyboard.

**Accessibility.** axe on every page type in CI; focus management for dialogs and popovers; `aria-live` for feedback; 44 px touch targets; `prefers-reduced-motion` honoured by every animation; contrast checked in both themes.

**Performance budget.** Fail CI if the home page ships more than 150 KB of JavaScript or any single lab or feature more than 60 KB gzipped.

**Content quality process.** Every authored item (question, rubric, definition, summary) goes through draft, self-check against its source, reviewer sign-off, merge. A checklist lives in `CONTRIBUTING`; each page shows "Report a problem" with a prefilled issue. See the implementation plan for the review checklist.

**Upstream sync.** `git fetch upstream && git merge upstream/master`. Strict mode fails the build if upstream renames a section; the fix is a one-line change in `scripts/site-map.mjs`. Translation changes from upstream will conflict with the deletions; keep the deletions.

## How we will know it helps

There are no analytics by design, so measure with small, honest checks:

1. **Pilot with 3 to 5 learners** after the quiz pilot (item 2): they study three topics, take the quiz cold, study again, and retake it. We want a clear score rise and a list of confusing questions.
2. **Error rate in authored content.** Track reviewer corrections per 20 items. If it stays above one, slow down and tighten the process before writing more.
3. **Self-reported usefulness.** A one-click "Was this useful?" that opens a prefilled issue; read it, do not chase a number.
4. **Completion.** Locally, the dashboard already shows whether the learner finished what they started; ask pilot learners to share a screenshot.

Decide at each pilot gate whether to continue, change the format or stop that line of work.

## Things deliberately not planned

- **User accounts, cloud sync, comments.** They need a backend and moderation; export and import cover moving between devices.
- **Translations.** The project is English only by decision.
- **AI-generated answers or an in-page chatbot.** Every claim should trace to a reviewed source.
- **A full spaced-repetition engine.** The simple scheduler is enough; Anki exists for people who want more, and the decks download directly.
- **Streaks and gamified points.** They reward visiting, not learning.
