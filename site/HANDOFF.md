# Handoff: learning features and the Databases section

Branch `learning-features`. **Nothing has been pushed**: the user asked for local commits only.

## Where things stand

The plan is [ADVANCED_DB_PLAN.md](ADVANCED_DB_PLAN.md). Phases 0 to 8 are built and committed:

| Phase | What |
|---|---|
| 0 | Lab review fixes; PGlite engine spike |
| 1 | Shared animation player; load-balancing failures and power of two choices; queue producer backlog |
| 2 | Databases foundations: seed, build-time runner, engine worker, playground, exercise format and checker |
| 3 | Pages on storage, B-trees, index design, scan types and reading EXPLAIN, with four animations |
| 4 | Exercise widget and 12 exercises, each proved on the engine |
| 5 | Joins (animation), planner statistics, pagination and N+1, slow-query checklist |
| 6 | Concurrency: 10 traces recorded on real PostgreSQL 18.3; transactions, isolation, locks, pooling |
| 7 | CTEs, window functions, views/functions/triggers, partitioning (pruning widget), replicas and sharding |
| 8 | 7 quizzes, 23 flashcards, interview questions, build checks for every claim the pages make |
| Labs | Deferred review items and a quiz on every lab (see below) |

## What is left

1. **A review by a second person.** Every Databases page, quiz, exercise and flashcard is marked Draft or `reviewed: false`. After review, remove `draft: true` in `DB_PAGES` and set `reviewed: true` (for flashcards, at the top of `content/flashcards/databases.yaml`).
2. **Lab improvements from the review are done.** They added a quorum lab, semi-synchronous replication with read-your-writes, DNS TTL, CDN counters, estimator headroom and overhead, a shared-queue curve, consistent-hashing copies, sharding traffic drift, a QUIC lane, 2Q eviction, a predict-mode self-check, and 70 lab quiz questions. All of it awaits the same second-person review.
3. **Premortem:** [ADVANCED_DB_PREMORTEM.md](ADVANCED_DB_PREMORTEM.md). Fixed: claims on every page with outputs, the exercise sandbox, `db:check`, a report link on Draft pages. Open: a named reviewer and date, the flag (the plan said off until reviewed), timing a start on two real phones, and whether to add production-scale recorded plans.
4. **Before pushing:** decide whether the section goes live. The `advancedDb` flag in `features.json` is on. After the first deploy, check that GitHub Pages serves the engine gzipped (about 5.6 MB).

## Rules for working on the Databases section

- **Outputs:** never type an output by hand.
  - `sql run / explain / explain-analyze / plan-tree / setup` blocks run at build time; outputs are cached in `data/db-runs.json`. `DB_RERUN=1` re-runs them.
  - Concurrency scenarios live in `content/databases/concurrency-scenarios.yaml`. Re-record with `node scripts/record-traces.mjs`, which needs Docker; `PGIMAGE=postgres:latest` uses the local image.
- **Tests:**
  - `tests/unit/db-claims.test.ts` re-checks every claim a page makes about its outputs. It reads the build, so run it after `npm run build`; in CI it fails if there is no build. It also fails if a page that shows real outputs has no test of what its prose says about them. `npm run db:check` builds and runs all three database suites in the right order.
  - `tests/unit/db-engine.test.ts` proves every exercise fails as written and passes with its solution.
  - `tests/unit/db-traces.test.ts` checks the recordings are current.
- **Flashcards:** progress is stored under each card's `id`, so fronts can be reworded; never change or reuse an id.
- **The engine:** PGlite 0.5.9 (PostgreSQL 18.6), with a single connection. It ignores `statement_timeout`, so the browser abandons any query after 30 s (`QUERY_LIMIT_MS` in `src/scripts/db/engine.ts`). The seed is deterministic: UTC, statistics over every row, and `VACUUM ANALYZE` run as a separate statement.
- **Windows quirks:**
  - Never pipe Playwright into `head`, and never run Vitest and Playwright together.
  - Stop the preview on port 4321 before running Playwright.
  - Heredocs and regex escapes often break in bash here; prefer the Write and Edit tools.

## Running it

```bash
cd site && npm run build && npm run preview
```

Then open http://localhost:4321/databases/.
