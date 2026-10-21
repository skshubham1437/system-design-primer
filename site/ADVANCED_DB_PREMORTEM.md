# Design premortem: the Databases section

A premortem of [ADVANCED_DB_PLAN.md](ADVANCED_DB_PLAN.md), run on 2026-10-21 after phases 0 to 8 were built. It assumes the section has already failed and works back to the assumptions that caused it.

**Scenario:** It's October 2027, a year after the section went live. It never earned learners' trust. Nobody else ever reviewed it, so all 21 pages still say Draft, and learners treat Draft as "might be wrong". Two pages whose prose nothing re-checks had drifted from their own outputs, and a reader found one. The tuning exercises taught learners to speed up a 6 ms query to 0.05 ms, which didn't feel like a real problem. On phones, the playground took long enough to start that most people gave up. And since the site collects no usage data, none of this showed up until a GitHub issue arrived.

**Design as understood:**
- A hybrid engine. PGlite (PostgreSQL 18.6 in WebAssembly) runs in a Web Worker and is loaded only when needed, for everything one session can show. Locks, isolation and deadlocks are recordings made on a real PostgreSQL 18.3 in Docker.
- Every output on a page comes from a real run at build time. Results are cached and keyed by the seed and the engine version, and a hand-written test re-checks what the prose says about them.
- The sample data is deterministic and was cut to 100k orders after the spike. Exercises are graded on plan shape and on returning the same rows, never on timing.
- Accuracy rests on three things: run everything, cite sources, then have a second person review. The `advancedDb` flag was meant to stay off until that review happened.
- One developer, about 55 days.

**Assumptions made:** the audience is mostly people preparing for interviews. "The section failed" means learners didn't trust it, didn't finish it, or couldn't use it.

## Load-bearing assumptions

| Assumption | How critical | Confidence | How to test it |
|---|---|---|---|
| A second person will review it | Critical: it's the last accuracy gate | **Hoped.** No one is named | Name someone and a date |
| What the build prints matches what learners' browsers produce | Critical | **Measured.** Same WebAssembly engine; the seed makes statistics cover every row (`default_statistics_target = 1100`) | Already tested in Node and Chromium |
| Every prose claim about an output is checked by a test | Critical | **Partly true.** 3 of 14 pages with real outputs had no checks | A test that requires checks on every page with outputs |
| Lessons on 100k rows carry over to production scale | High | **Estimated.** The median recorded execution time is 5.7 ms | A 5-person learner test on the plan-reading page |
| The playground is usable on phones | High | **Hoped.** Phase 0 said "mid-range phone"; the spike only measured a desktop (2.8 s; 6.3 s seen in the browser pane on 2026-10-21) | Two real phones, 30 minutes |
| An exercise attempt can never change the database | Medium | **False** (see story 5) | Confirmed in the code |
| One person can keep PGlite builds, Docker recordings and three test layers running | Medium | Hoped | Have a fresh session re-record one trace using only HANDOFF.md |
| Staying on PGlite 0.5.9 for good is safe | Medium | **Measured.** The engine ships with the site, not from a CDN | The engine browser tests run on every deploy |

## Top risks

| # | Failure mode | Category | Likelihood | Impact | One-way door? |
|---|---|---|---|---|---|
| 1 | The review never happens, and the flag is on anyway | Delivery / people | High | High | No |
| 2 | Prose with no checks drifts from its outputs | Correctness | Med | High | No |
| 3 | 100k rows makes "slow" queries unconvincing | Product | Med | Med | **Yes**: the seed size is baked into every output and number |
| 4 | Playground too slow or crashes on phones | Product / capacity | Med | Med | No |
| 5 | An exercise escapes its sandbox with `COMMIT`, or fails on `CONCURRENTLY` | Correctness | Med | Low–Med | No |
| 6 | No way to tell whether the section is working | Operability | High | Med | No |
| 7 | Nobody can maintain the content pipeline | Operability | Med | Med | No |

## Failure stories

### 1. Draft forever
**What happened:** No reviewer turned up. The section went live with the flag on and every page said Draft for a year. Careful learners skipped it, and quick ones memorised whatever it said.

**Root assumption:** that a reviewer would turn up. The approved plan said `advancedDb` stays "off until reviewed" (phase 2) and the flag is removed after review (phase 8). The flag is on before any review, which departs from the approved plan.

**Recommendation:**
- Name a reviewer and a date.
- Make review chunks small: one module at a time, starting with "Reading EXPLAIN" and the concurrency pages.
- Set a fallback: if nobody has signed off by the date, ship each module with a "Report a problem" link in its Draft note.

### 2. The pages nobody checks
**What happened:** A later edit or an engine upgrade changed an output on "How a table is stored". The prose kept describing the old `ctid`/`xmin` values, and nothing failed.

**Root assumption:** that "build checks for every claim" covers every claim. `db-claims.test.ts` checked 11 pages. `how-rows-are-stored` (4 outputs), `transactions` (2) and `locks-and-deadlocks` (1) had no checks, and nothing made a newly added page get them.

**Recommendation:**
- Add a test that fails when any Databases page with real outputs has no claims block.
- Write the missing claims for those three pages.

### 3. "Slow" was 6 milliseconds
**What happened:** Learners did the tuning exercises, saw 6 ms drop to 0.05 ms, and shrugged. At this size the planner also chooses differently than it would on a 50-million-row table.

**Root assumption:** that plan shapes and Buffers counts carry the lesson without timings that feel slow. Across the 31 recorded plans with timings, the median is 5.7 ms, the 90th percentile 145 ms and the maximum 674 ms. The plan's own fallback, "plans at larger sizes are shown from recorded runs", was never built.

**Recommendation:** treat the seed size as fixed, because changing it later means re-running every output and rewriting every number in the prose. Instead:
- Record "at production scale" sidebars for 2 or 3 key examples (seq scan vs index scan, OFFSET, a bad estimate). Use a 10M-row Postgres in Docker, the same way the traces were made.
- Run a quick learner test first, to see whether the small numbers actually bother people.

### 4. Phones gave up
**What happened:** A mid-range Android phone took 15 s or more to start the engine, and iOS Safari sometimes killed the tab.

**Root assumption:** that phase 0 measured phones. It measured one desktop. The 375 px end-to-end tests run desktop Chromium at phone width.

**Recommendation:**
- **Experiment:** time a real start on one iPhone and one mid-range Android.
- **Tripwire:** if a start takes more than 10 s or the tab crashes, tell phone users up front before the 5.6 MB download, and lean on the embedded outputs, which work without JavaScript.

### 5. The sandbox leaks
**What happened:** A learner read the locks page and tried `create index concurrently …` in an exercise. They got a raw "cannot run inside a transaction block" error. Another learner typed `commit;`, which escaped the rollback. Their index stayed in place, so the other exercises on "Designing indexes" passed or failed for the wrong reasons until they reloaded.

**Root assumption:** that "DDL is allowed and Reset undoes it" (B.5). `runAttempt` ran the learner's changes with a plain `exec` inside `begin`/`rollback`, and nothing blocked transaction-control statements. The exercise widget has no Reset button. The locks page recommends `CONCURRENTLY`.

**Recommendation:**
- Reject transaction-control statements and `VACUUM` in the changes box with a clear message.
- Rewrite `create index concurrently` to a plain `create index`, with a note explaining why.

### 6. Failing silently
**What happened:** There was no signal at all: no analytics, and no way to see where people stop or whether anyone finishes an exercise.

**Root assumption:** that you'd somehow know. A static site on GitHub Pages collects nothing.

**Recommendation (owner's call):** either accept running blind and rely on a "Report a problem" link on every page, or add privacy-friendly page counts (no cookies) only on the Databases pages.

### 7. The pipeline only one person understands
**What happened:** Ten months later, re-recording a trace meant remembering Docker, `PGIMAGE`, `DB_RERUN`, the order of the test suites and the Windows quirks. It got postponed, and the content froze.

**Recommendation:** add one `npm run db:check` command that runs the build and the database tests in the right order, and prove that re-recording one trace works from the docs alone.

## Open questions
1. Who reviews, and by when? What happens if nobody does?
2. Should `advancedDb` stay on, or go off until review as the plan said?
3. How will we know whether the section works for learners?
4. Is 100k orders final? It effectively can't be changed later.
5. Should the exercise sandbox accept `CONCURRENTLY` (rewritten), or refuse it with an explanation?

## What the design gets right
- **The engine decision.** It corrected the premise about live locks early, chose the hybrid deliberately, and the spike rejected the 1.5M-row dataset on measured numbers.
- **Real outputs only.** The cache is keyed by seed and engine, ANALYZE covers every row so statistics are deterministic, and pages show the engine version.
- **Grading.** Checks look at plan shape and result, never timing. The result check stops learners "fixing" a query by deleting its WHERE clause.
- **No outside dependency.** The engine ships with the site and is pinned.
- **Sources and honesty.** Every content page has a source list. MySQL differences are labelled "not run here". Draft is shown honestly.

## Before merging and turning the flag on
1. Decide on the reviewer and the flag (risk 1).
2. Add claims checks for the 3 unchecked pages, plus the test that requires them (risk 2).
3. Close the sandbox escape and handle `CONCURRENTLY` (risk 5).
4. Time a start on two real phones (risk 4).
5. Decide whether to record "at production scale" sidebars for 2 or 3 examples (risk 3).
