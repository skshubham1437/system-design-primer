# Implementation plan

How to build what is in [ROADMAP.md](ROADMAP.md): the order, the tasks, the files they touch, how each is tested, and when to stop and check before continuing. Read the roadmap first for the reasoning; this document is the execution plan.

Assumptions: one developer working full time, a second person available for content review, and the current codebase (Astro, the `scripts/build-content.mjs` pipeline, `src/scripts/*.ts`, GitHub Pages deploy).

## Status

| Phase | State | Notes |
|---|---|---|
| A. Groundwork (A1 to A6) | **Done** | Unit tests (67), end-to-end tests (29 runs over every page at desktop and phone width, with axe), feature flags, content guide, CI runs all of it |
| 1. Foundation and spaced flashcards (F1 to F7) | **Done** (M1) | Progress store, scheduler, migration, flashcards UI, data panel, due badge |
| 2. Quizzes and dashboard | Next | Q1 is the first task |
| 3 to 5 | Not started | |

### Decisions made while building

- **Boxes and intervals.** The scheduler uses box 0 (new or relearning) plus boxes 1 to 5 with intervals of 1, 3, 7, 21 and 60 days. Again returns a card to box 0 and shows it again in the same session. This replaces the "0/1/3/7/21" wording in the roadmap.
- **Theme and diagram preference stay in their own keys.** The page reads them in a blocking script before first paint to avoid a flash of the wrong theme, which needs synchronous access outside the progress store. Only learning state (planner, flashcards, and later quizzes, solutions, sessions) lives in `primer:v1`.
- **Daily new-card limit** is stored in the document (`daily`) so it survives a reload.
- **Findings from the new tests, already fixed:** two progress bars had no accessible name; scrollable tables were not reachable by keyboard; the Reset section closed itself when the panel re-rendered.
- **Colour contrast is not yet checked by axe** (the rule is disabled in `pages.spec.ts`) because it needs a per-theme pass. It is a tracked follow-up before M2.

## 1. Delivery strategy

Ship in five milestones. Each is a complete, useful release, so work can stop after any of them without leaving half a feature behind.

| Milestone | Name | What a learner gets | Target |
|---|---|---|---|
| M1 | Spaced review | Flashcards that schedule themselves; one place that remembers your progress | End of week 2 |
| M2 | Learn and test | Quizzes on every topic, a progress dashboard, "next up" | End of week 5 |
| M3 | Practise like an interview | "Try it first" solutions with rubrics and follow-ups, decision aids | End of week 8 |
| M4 | Understand it visually | Guided scaling path, prerequisites, interactive visuals, glossary | End of week 11 |
| M5 | Depth and polish | Architecture summaries, link health, new topics, mock interviews, offline | End of week 14 |

Two **gates** exist to avoid building a lot of content on an unproven format:

- **Gate A (after the quiz pilot, week 3).** Three topics are live. Five learners try them. Continue to the other 13 topics only if scores rise and fewer than one question per 20 needs correcting.
- **Gate B (after the Pastebin practice-mode pilot, week 6).** Same test for "try it first". Continue to the other seven solutions only if learners finish a run and say it helped.

If a gate fails, change the format and re-pilot instead of pushing on.

Total estimate: about 63 engineering days plus about 15 days of content authoring and review. Content runs in parallel with engineering from week 3.

## 2. Architecture decisions made up front

These keep the work consistent and avoid rework.

**Where content lives.** Everything authored is data, not code, under `site/content/`:

```
site/content/
  labs/*.md                 (exists)
  quizzes/<topic>.yaml
  practice/<solution>.yaml  (rubrics and follow-ups)
  choosers/<name>.yaml
  glossary.yaml
  path/scaling-story.md
  architectures/<company>.md
  data/link-status.json     (written by the weekly workflow)
```

**One validator per content type**, all in `scripts/validate/*.mjs`, all run by `build-content.mjs`. They throw on malformed content and, like the existing structural checks, are fatal under `STRICT=1`/CI. Shared helpers (anchor resolution, id uniqueness) live in `scripts/lib/`.

**How content reaches the browser.** Page HTML stays as it is. Feature data is emitted at build time as small JSON files (`dist/data/quiz/<topic>.json`, `dist/data/glossary.json`, and so on) and fetched on demand by the feature that needs it. This keeps pages light and lets the offline cache treat data separately.

**Client code layout.**

```
src/lib/        progress.ts, srs.ts, features.ts     (pure, unit-tested, no DOM)
src/scripts/features/   flashcards.ts, quiz.ts, practice.ts, chooser.ts, glossary.ts, path.ts, mock.ts
src/scripts/ui.ts       loads a feature module only when its mount point exists
```

Each feature mounts on a `data-feature="…"` element and is dynamically imported, the same way labs load today.

**Feature flags.** `site/features.json` (`{ "quiz": true, "practice": false, … }`) read at build time. Unfinished work can be merged to `master` and deployed switched off, which keeps branches short and avoids long-lived merges.

**Storage.** All state goes through `src/lib/progress.ts` (task F1). No feature touches `localStorage` directly after it exists.

**Dependencies.** Add only `vitest`, `@playwright/test`, `@axe-core/playwright` and `js-yaml` (build time). No runtime libraries on the client.

## 3. Working agreements

- **One task, one pull request**, named `feat/<task-id>-short-name`. CI must pass (build, strict mode, link check, unit tests, smoke tests).
- **Tests land with the code**, not after. Pure logic gets unit tests; user flows get a smoke test.
- **Content is reviewed in its own pull request** by someone other than the author, using the checklist in section 10.
- **Definition of done** for every task: works with JavaScript off (or degrades to the current page), works on a 375 px phone, operable by keyboard only, no console errors, axe clean, within the bundle budget, ROADMAP/README updated if behaviour changed.

## 4. Phase A: Groundwork (week 1, 2 days)

Nothing user-visible. This is what makes the rest safe.

| ID | Task | Files | Depends | Est | Done when |
|---|---|---|---|---|---|
| A1 | Extract pure functions from `build-content.mjs` (`resolveHref`, anchor map building, heading slug helpers, the cache and load-balancer simulators) into importable modules | `scripts/lib/links.mjs`, `src/lib/sim/*.ts` | none | 0.5 d | Build output byte-identical before and after (diff `site.json`) |
| A2 | Vitest setup and first tests: link resolution cases (relative, anchor, github URL, `>1` suffix), simulators (known sequences give known hit rates; deterministic seeds) | `vitest.config.ts`, `tests/*.test.ts` | A1 | 0.5 d | `npm test` runs in CI |
| A3 | Playwright smoke suite: home, a topic page, search returns a hit, a lab renders, mobile drawer opens, zero console errors across all pages | `tests/e2e/*.spec.ts`, `.github/workflows/ci.yml` | none | 0.5 d | Runs on pull requests against `npm run preview` |
| A4 | axe checks inside the smoke suite for each page type | same | A3 | 0.25 d | Fails on serious or critical issues; existing issues fixed or listed |
| A5 | Feature flags file and helper; content validator scaffolding (`scripts/validate/index.mjs`) | `features.json`, `scripts/validate/` | none | 0.25 d | A flag off hides the feature from the build |
| A6 | Contributor docs for content: review checklist, issue template "Problem with this question/definition", PR template section | `CONTRIBUTING.md`, `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md` | none | 0.25 d | Checklist from section 10 is published |

**Risks.** A1 touches the build core: keep it mechanical and compare outputs.

## 5. Phase 1: Foundation and spaced flashcards (week 2, 3 days) → M1

| ID | Task | Files | Depends | Est | Done when |
|---|---|---|---|---|---|
| F1 | Progress store: versioned document, `get/update/subscribe/export/import/reset`, debounced writes, cross-tab sync, in-memory fallback | `src/lib/progress.ts` | A2 | 1 d | Unit tests: corrupt JSON, quota errors, version migration, import validation with backup, two-tab sync |
| F2 | Scheduler: Leitner boxes 1 to 5, intervals 0/1/3/7/21 days, `grade`, `isDue`, `nextDue`, local-midnight day boundaries | `src/lib/srs.ts` | A2 | 0.5 d | Unit tests: day 0, 1, 3, 7 progression; Again resets; overdue stays due; DST and clock changes |
| F3 | One-time migration from `primer:plan:v1`, `primer:cards:v1`, `theme`, `diagrams`; known cards become box 3 | `src/lib/progress.ts` | F1 | 0.25 d | Test: old keys in, new document out, old keys removed only after a successful write |
| F4 | Port the study planner to the store | `src/scripts/widgets.ts` | F1 | 0.25 d | Planner behaviour unchanged, progress preserved |
| F5 | Flashcards UI on the scheduler: "Due today (N)", Again/Good/(Easy), new-cards-per-day setting, session summary, "browse all" mode | `src/scripts/features/flashcards.ts`, `flashcards.css` | F1, F2 | 1 d | Smoke test grades a card and sees it leave the due queue |
| F6 | "Your data" panel on About: export, import, reset (per section and all) | `src/pages/[...slug].astro` mount, `src/scripts/features/data-panel.ts` | F1 | 0.5 d | Round trip export/import in a fresh browser context |
| F7 | Due-count badge on the Flashcards nav link | `Sidebar.astro`, `ui.ts` | F1, F2 | 0.25 d | Badge updates after grading, hidden at zero |

**M1 release checklist.** Existing users lose nothing; flashcards, planner and About panel work offline of any server; ROADMAP updated.

## 6. Phase 2: Quizzes and the dashboard (weeks 3 to 5) → M2

### 6.1 Quiz engine and pilot (weeks 3 to 4)

| ID | Task | Files | Depends | Est | Done when |
|---|---|---|---|---|---|
| Q1 | Quiz schema and validator: one correct index, 3 to 5 choices, unique ids, `link` anchors resolve against the anchor map, `why` required | `scripts/validate/quizzes.mjs` | A5 | 0.5 d | Tests for each rule; strict build fails on a bad file |
| Q2 | Emit `dist/data/quiz/<topic>.json`, list available quizzes in `site.json`, add "Test yourself" mount to topic pages | `build-content.mjs`, `[...slug].astro` | Q1 | 0.5 d | Pages with a quiz show the mount; pages without do not |
| Q3 | Quiz UI: one question at a time, seeded shuffle, keys 1 to 4 and Enter, immediate feedback with explanation and section link, results screen, `aria-live` announcements | `src/scripts/features/quiz.ts`, `quiz.css` | F1, Q2 | 1.5 d | Smoke test completes a quiz by keyboard only; axe clean |
| Q4 | Scheduler integration: missed questions get a due date; "Review" quiz of due items | `quiz.ts`, `src/lib/srs.ts` | F2, Q3 | 0.5 d | Unit test: a miss returns tomorrow, then 3 days |
| Q5 | "Report a problem" link per question (prefilled GitHub issue with the question id) | `quiz.ts` | A6 | 0.25 d | Link opens the issue form with id and topic filled |
| Q6 | **Pilot content**: 6 questions each for Cache, Database, Load balancer (18 total), written to the section 10 standard | `content/quizzes/*.yaml` | Q1 | 1 d | Reviewer sign-off recorded in the PR |
| Q7 | **Gate A**: five learners take the pilot cold, study, retake. Collect score change and confusing questions | none | Q6, Q3 | calendar 3 to 4 d | Written result; decision to continue, change, or stop |

### 6.2 Quiz roll-out (week 5, content-heavy)

| ID | Task | Est | Done when |
|---|---|---|---|
| Q8 | Questions for the remaining 13 topics (about 80 questions), in batches of 3 topics per PR | 3 d authoring + 2 d review | Every topic page shows a quiz; all validate in strict mode |
| Q9 | Mixed quiz page `/quiz/` weighted toward read topics and misses | 0.5 d | Draws only from topics read; honours due items first |

### 6.3 Dashboard (weeks 4 to 5, runs alongside)

| ID | Task | Files | Depends | Est | Done when |
|---|---|---|---|---|---|
| D1 | Read tracking: mark read when the article end is seen and at least 40% of estimated reading time has passed; store `pct` | `src/scripts/features/read-tracking.ts` | F1 | 0.5 d | Unit test on the rule; jumping to the bottom does not count |
| D2 | Sidebar marks (empty / half / filled) with text alternatives; solution status control (not started, attempted, done) | `Sidebar.astro`, `ui.ts` | D1 | 0.5 d | Marks update in another open tab |
| D3 | `/progress/` page: group rings, flashcards due and mastered, quiz scores by topic with the weakest highlighted | `src/pages/progress.astro`, `features/progress-page.ts` | D1, F5, Q4 | 1 d | Renders with empty, partial and full data |
| D4 | "Next up" logic: due cards, then weakest quiz topic, then first unread topic in the trail, then first solution not done | `src/lib/next-up.ts` | D1 | 0.5 d | Unit tests for each priority and for pages renamed upstream |

**M2 release checklist.** Gate A passed; all 16 topics have quizzes; dashboard works with no data and with full data; performance budget holds; ROADMAP updated; announce in the repo README.

## 7. Phase 3: Practise like an interview (weeks 6 to 8) → M3

### 7.1 "Try it first" solutions

| ID | Task | Files | Depends | Est | Done when |
|---|---|---|---|---|---|
| S1 | Pipeline: wrap each solution H2 step in `<section data-step>`; keep output identical when the feature is off | `build-content.mjs` | A1 | 0.5 d | No-JS rendering unchanged (snapshot test) |
| S2 | Practice schema and validator: every solution has the four steps, prompts, rubric items, follow-ups; ids unique | `scripts/validate/practice.mjs` | A5 | 0.5 d | Tests per rule |
| S3 | Practice UI: mode toggle, one step at a time, notes box autosaved, "Reveal reference", rubric checklist, end summary of missed items, resume where you left | `features/practice.ts`, `practice.css` | F1, S1 | 2 d | Smoke test runs a full practice session; keyboard and phone OK |
| S4 | Follow-ups ("Push it further") rendered as collapsible hidden-answer items | `practice.ts` | S2 | 0.5 d | Answers hidden until opened |
| S5 | **Pilot content for Pastebin**: rubric for 4 steps and 5 follow-ups | `content/practice/pastebin.yaml` | S2 | 0.5 d | Reviewer sign-off |
| S6 | **Gate B**: learners complete Pastebin in practice mode | none | S3, S5 | calendar 3 d | Decision recorded |
| S7 | Rubrics and follow-ups for the other seven solutions | `content/practice/*.yaml` | S6 | 4 d authoring + 1.5 d review | All eight validate; strict build passes |

### 7.2 Decision aids

| ID | Task | Files | Depends | Est | Done when |
|---|---|---|---|---|---|
| C1 | Chooser schema and validator: every branch ends in an answer, no orphan nodes, scenario has one best answer and reasons for the others, links resolve | `scripts/validate/choosers.mjs` | A5 | 0.5 d | Tests per rule |
| C2 | Chooser UI with "Guide me" tree and "Test me" scenarios; results recorded to the store | `features/chooser.ts`, `chooser.css` | F1, C1 | 1.5 d | Smoke test runs both modes |
| C3 | Content: SQL or NoSQL (pilot), then cache update pattern, load-balancing algorithm, consistency model, REST vs RPC vs messaging | `content/choosers/*.yaml` | C1 | 2.5 d + review | Five choosers live, each linked from its topic page |

**M3 release checklist.** Gate B passed; eight solutions have practice mode; five choosers live; dashboard counts attempted solutions and chooser results.

## 8. Phase 4: Understand it visually (weeks 9 to 11) → M4

### 8.1 Guided path and prerequisites

| ID | Task | Files | Depends | Est | Done when |
|---|---|---|---|---|---|
| G1 | `PREREQS` map and "Before this" chips; strict check for missing paths and cycles | `scripts/site-map.mjs`, `[...slug].astro` | A5 | 0.5 d | Cycle test fails the build |
| G2 | Stage component: accumulating inline-SVG architecture, stage navigation, predict-first mode, progress saved | `features/path.ts`, `path.css` | F1 | 2 d | Works without JS as a numbered article |
| G3 | Content: nine stages of the scaling story, each with symptom, fix, trade-off, links | `content/path/scaling-story.md` | G2 | 1 d + review | Every stage links to a real topic and lab |

### 8.2 Interactive visuals

Build the shared stepper first, then one visual at a time in this order. Each is a separate pull request.

| ID | Task | Est |
|---|---|---|
| V0 | Shared stepper (controls, play/pause, reduced-motion, text description slot) | 1 d |
| V1 | Database replication (lag, stale read, failover) | 1.5 d |
| V2 | Sharding (range, hash, directory; hot key) | 1.5 d |
| V3 | Message queue and back pressure | 1.5 d |
| V4 | DNS resolution walk-through | 1.5 d |
| V5 | CDN push and pull | 1.5 d |
| V6 | TCP and UDP over a lossy link | 1.5 d |

Each visual adds a "Try it" link from its topic page (the `RELATED_LABS` mechanism already exists) and a unit test for its state logic.

### 8.3 Glossary

| ID | Task | Files | Depends | Est | Done when |
|---|---|---|---|---|---|
| L1 | Glossary schema and validator; `/glossary/` page; terms in the search palette | `content/glossary.yaml`, `scripts/validate/glossary.mjs` | A5 | 1 d | Page lists terms A to Z with filter |
| L2 | Rehype plugin wrapping the first occurrence per page; whole-word; skips code, headings and links | `scripts/lib/glossary-plugin.mjs` | L1, A1 | 1 d | Unit tests: no match inside "cache-aside", links, code, headings |
| L3 | Popover UI (focus, hover, tap, Escape; does not hijack link taps) | `features/glossary.ts` | L2 | 0.5 d | Keyboard and screen-reader pass |
| L4 | About 120 definitions | `content/glossary.yaml` | L1 | 2 d + review | Reviewer sign-off |

**M4 release checklist.** Path complete, six visuals live, glossary live, bundle budgets hold, mobile checked for each.

## 9. Phase 5: Depth and polish (weeks 12 to 14) → M5

| ID | Task | Est | Notes |
|---|---|---|---|
| H1 | Link health: extend the weekly workflow to write `data/link-status.json` through a bot PR; build rewrites dead links to an archived copy and marks them | 2 d | Absent or stale file must never break the build |
| H2 | Eight architecture summaries (Netflix, Twitter, Uber, Dropbox, Instagram, WhatsApp, YouTube, Facebook) | 4 d + review | Every number cited |
| H3 | Content gaps: rate limiting (with lab and worked solution), unique IDs, idempotency, pagination, observability, consistent hashing write-up, scatter-gather, MapReduce, deepen DNS, Security, Reverse proxy | about 10 d + review | One page per PR; license note |
| I1 | Mock-interview session: timer from timestamps, phase notes, estimator panel, review screen, Markdown export | 3 d | Embedding the estimator needs a small refactor in `labs.ts` |
| O1 | Offline and installable: manifest, icons, service worker, build-generated precache list, update toast, opt-in full prefetch | 2 d | Test the update path explicitly |

## 10. Content authoring standard

Applies to every question, rubric item, definition, summary and chooser scenario.

**Process.** Draft from a named source section, self-check against it, open a pull request containing content only, get a second person's review, merge. Reviewers never review their own writing.

**Reviewer checklist.**
- [ ] The answer is correct, and I verified it against the linked section or a primary source.
- [ ] Exactly one choice is defensible; the wrong ones are plausible but clearly wrong for a stated reason.
- [ ] The explanation says *why*, not just *what*, and the link lands on the right heading.
- [ ] No trick wording; tests understanding rather than trivia.
- [ ] Numbers and claims are cited; archived copies used when originals are gone.
- [ ] Plain language; terms defined or in the glossary.
- [ ] Nothing copied from copyrighted sources; original wording.

**Quality bar.** If a reviewer corrects more than one item in 20, stop writing new content and tighten the process (clearer source notes, smaller batches) before continuing.

## 11. Test strategy

| Layer | What | Tools | When it runs |
|---|---|---|---|
| Unit | Link resolution, scheduler, progress store, simulators, next-up, validators, glossary plugin | Vitest | Every pull request |
| Content validation | Every YAML/Markdown content file | `STRICT=1` build | Every pull request and deploy |
| Link integrity | Internal links and anchors in the built site | `check-links.mjs` | Every pull request and deploy |
| End to end | Home, topic, search, labs, drawer, a quiz by keyboard, a practice session, a flashcard grade | Playwright (desktop and a 375 px viewport) | Every pull request |
| Accessibility | axe on each page type | `@axe-core/playwright` | Every pull request |
| Performance | JavaScript size budgets | A script comparing built chunk sizes | Every pull request |
| Manual | Real phone, screen reader spot-check, offline test before M5 | Human | Before each milestone |

## 12. Risks and responses

| Risk | Likelihood | Impact | Response |
|---|---|---|---|
| Wrong or ambiguous quiz answers | Medium | High | Second reviewer, pilot gates, "Report a problem" link, error-rate rule in section 10 |
| Pilot shows learners do not use quizzes or practice mode | Medium | High | Gates exist for this; change the format before writing more content |
| Content volume (about 15 days of authoring) outruns review capacity | High | Medium | Batch by three topics, ship per batch, keep the feature flag on only for finished topics |
| Storage loss or corruption wipes progress | Low | High | Validated import with automatic backup, export prompt after a long streak of use, in-memory fallback |
| Upstream renames a README section | Medium | Medium | Strict build fails loudly; one-line fix in `site-map.mjs` |
| Service worker serves stale content | Medium | Medium | Offline is last; explicit update test; versioned caches; never cache the worker file |
| Bundle growth slows the site | Medium | Medium | Lazy-load each feature; size budget in CI |
| Scope creep into accounts, sync or gamification | Medium | Medium | Listed under "not planned" in the roadmap; revisit only with evidence |

## 13. Timeline

```
Week   1   2   3   4   5   6   7   8   9  10  11  12  13  14
A      ██
F           ██                                                  M1
Q               ██  ██  ██                                      Gate A, M2
D                   ██  ██
S                           ██  ██  ██                          Gate B
C                               ██  ██                          M3
G/V/L                                       ██  ██  ██          M4
H/I/O                                                   ██  ██  ██  M5
Content        ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░
```

Content authoring and review (░) runs continuously from week 3, one batch per pull request.

**If time is short, cut in this order** (last first): offline (O1), mock interview (I1), visuals V4 to V6, glossary content beyond 60 terms, architecture summaries beyond four. Never cut: the store, spaced flashcards, quizzes, the pilot gates, tests.

## 14. First week, day by day

1. **Day 1.** A1 and A2: extract the pure functions, prove the build output is unchanged, first unit tests.
2. **Day 2.** A3, A4, A5, A6: smoke suite, axe, feature flags, contributor docs. Open the CI workflow change.
3. **Day 3.** F1: the progress store with its tests.
4. **Day 4.** F2 and F3: scheduler, migration.
5. **Day 5.** F4 and start F5: port the planner, begin the flashcard rewrite.

At the end of week 1, nothing new is visible to learners, but every later task has tests, flags and a store to build on.
