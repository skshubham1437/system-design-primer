# Plan: lab review and the "Advanced Databases" section

Status: **phases 0 to 8 built** (October 2026), on branch learning-features, not pushed. 21 Databases pages, 12 exercises, 10 recorded traces, 7 quizzes, 23 flashcards. Every page is still marked Draft: the remaining step is a review by a second person, after which the Draft flags (draft: true in DB_PAGES, reviewed: false in quizzes and exercises) can be removed. Deferred lab improvements from Part A are tracked in HANDOFF.md.

## Phase 0 spike report (measured)

| Question | Answer |
|---|---|
| Engine | **PostgreSQL 18.6** (PGlite 0.5.9, 32-bit WebAssembly). Plans use the PG 18 format: actual rows are shown with decimals (`rows=1.00`) and index scans print `Index Searches`. The reading guide is written for this output. |
| Download | `pglite.wasm` 10.1 MB, `pglite.data` 6.3 MB, `initdb.wasm` 0.4 MB, worker JS 0.6 MB. Gzipped: 3.4 + 1.9 + 0.1 MB, about **5.6 MB** in total (the docs' "under 3 MB" does not hold for this version). |
| GitHub Pages | Works without cross-origin isolation (tested in the browser with `crossOriginIsolated = false`). The live site already serves binary files gzip-encoded (checked on the Pagefind WebAssembly), so the transfer should be the gzipped size. Recheck after the first deploy. |
| Bundling | Vite bundles PGlite and a module worker with no config changes. PGlite's own code triggers harmless "direct eval" build warnings. |
| Browser timing | In a Web Worker on this machine: engine ready and 100k orders seeded and analysed in **2.8 s** total, the seed itself 0.5 s. |
| Dataset | The full target (100k users, 500k orders, 1.5M items) took 43 s to seed in Node, 1 GB of memory and 176 MB of disk: **rejected**. Loading rows first and adding keys afterwards, at 20k users, 2k products, 100k orders and 300k items: 3.9 s in Node, 39 MB. **Chosen.** |
| Snapshot instead of seeding | A gzipped data-directory dump is 17.8 MB and loads in 1.2 s. Seeding is smaller to download, so seed in the browser. |
| Features | PL/pgSQL functions, recursive CTEs, materialized views, declarative partitioning with pruning, `pg_locks` for the current transaction, `xmin`/`xmax`/`ctid` and `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` all work. Plan shapes repeat between runs. |
| Concurrency | Confirmed single connection, so two-session locks and deadlocks use recorded traces (as planned). |

Go.

Every number in Part A was measured by running the real simulation modules (seeded, so they repeat) or by reading the code. Where a finding comes from reading code only, it says so.

---

## Part A. Review of the 13 labs

### A.1 Things that are clearly wrong (fix first, small)

| # | Lab | What is wrong | Evidence | Fix | Effort |
|---|-----|---------------|----------|-----|--------|
| 1 | Load curve | The page says latency is "nearly constant until about 70% busy", and the widget says "flat until a server gets busy". It is not flat. | Measured with the model: 50% busy = **2.0x** the idle time, 70% = **3.3x**, 75% = 4.0x, 90% = 10x, 99% = 100x. | Reword. Mark 50 / 75 / 90% on the chart with their multipliers. Keep "the knee" message but say it starts early. | 0.25 d |
| 2 | Load balancing | The page says IP hash "looks balanced by request count but not by work when one client is hot". It is not balanced by count either. | 4 servers, requests per server: no hot client `36,16,12,35`; hot client `17,5,16,58`. | Rewrite the bullet: hashing follows client skew in count and in work. | 0.1 d |
| 3 | Load balancing | "Least connections" breaks ties by always choosing the lowest-numbered server. Identical servers then show an uneven split. | 6 identical servers: `35,38,28,26,17,6`. Real balancers break ties randomly or in rotation. | Random tie-break (seeded). Add a unit test that identical servers get a near-even split. | 0.25 d |
| 4 | Load balancing | One seed means one lucky or unlucky run decides the table. Random beats round robin on p95 with 4 servers (24 vs 31) but loses with 6 (33 vs 21). | Same probe. | Run each algorithm over about 20 seeds and show the median and the range. The lesson "one run proves nothing" becomes part of the lab. | 0.5 d |
| 5 | Load balancing | The closing paragraph says "these are layer 7 decisions" and then says they can be made at either layer. It contradicts itself. | Read the page. | Rewrite. | 0.1 d |
| 6 | Cache eviction | "On uniform traffic the real policies land within a few points of each other." The spread reaches 10 points. | Cache size 6: LRU 45%, LFU 40%, FIFO 50%, random 50%. | Say "within about ten points". | 0.1 d |
| 7 | Cache eviction | Missed "aha": on the loop pattern, **random** hits 52% while LRU, FIFO and LFU all hit 0%. The page only mentions LRU and FIFO. | Cache size 4. | Add a sentence and a "why" line to the page. | 0.1 d |
| 8 | Cache eviction | Only 60 requests and 8 keys in "hot keys". At cache size 6 or more every policy reaches 90%, so the slider does nothing for most of its range. | Probe at sizes 6 and 8. | Longer sequences (300) and a Zipf-shaped pattern. See B-list item. | 0.5 d |
| 9 | CAP | **From reading the code, not run:** after healing, the "silently discarded" list includes writes from the *winning* side that were simply overwritten by a later write on the same side. The message overstates what conflict lost. | `lost = divergedWrites.filter(w => w.ts !== winner.ts)` | Only list writes from the other side. Move the logic into `src/lib` and unit test it. | 0.5 d |
| 10 | TCP vs UDP | Step 4 says "every recovery waits for a timeout based on the round-trip time". The model uses RTO = 2 x RTT and has no fast retransmit; real TCP usually recovers through duplicate ACKs well before a timeout. The "leaves out" section admits it, but the step reads as fact. | `transport.ts` | Reword step 4 as "in this model"; add a line about fast retransmit and about QUIC (reliable delivery over UDP). | 0.25 d |
| 11 | Site | `features.json` has `"guidedPath": false` although the scaling story shipped. Nothing reads the flag. | grep: only in generated JSON | Remove the stale flag or wire it. | 0.1 d |
| 12 | Labs | Seven labs have no "Before this" chips (consistent hashing, load balancing, load curve, DNS, CDN, TCP vs UDP, estimator). | `PREREQS` map | Add them (for example DNS lab needs `learn/dns/`). | 0.25 d |

Total for A.1: about **3 days**, including tests. I would do these first because they are small and each one is a claim a learner could repeat wrongly.

### A.2 Per-lab review and proposed improvements

Scores are my judgement: Accuracy, Learning value, Interaction, Connections (good / ok / weak).

| Lab | Accuracy | Learning | Interaction | Connections | Main gap and proposal | Effort | Priority |
|-----|----------|----------|-------------|-------------|-----------------------|--------|----------|
| Estimator | good | good | good | ok | No overhead (indexes, metadata add roughly 1.5x to 2x to raw storage), no headroom (uses 100% of a server, which contradicts the load-curve lab's 70% target), bandwidth shown in bytes not Gbps, the 1,000 writes/s warning is conservative for a tuned primary. Add a headroom input, an overhead factor, Gbps, and a link from each preset to its solution page. Shareable URL. | 1 d | Medium |
| Consistent hashing | good | good | good | ok | Only the ring. Add: replication (walk to the next N distinct nodes), a hot-key case that vnodes cannot fix, and a comparison with rendezvous hashing in one paragraph. "What the model leaves out" missing. | 1 d | Low |
| Cache eviction | ok (A.1 #6-8) | ok | ok | ok | Add Zipf traffic, TTL expiry, and one scan-resistant policy (2Q or TinyLFU) so "LRU is flushed by scans" has a fix. Link the LRU walkthrough page (`practice/object-oriented/lru-cache/`). | 1.5 d | Medium |
| Load balancing | ok (A.1 #2-5) | good | ok | ok | No step control (only play/pause). No "kill a server" and no health checks, which is the main reason a balancer exists. Add power of two choices, a failure scenario, and a goal ("keep p95 under 20"). | 2 d | High |
| Load curve | ok (A.1 #1) | good | good | good | Per-server M/M/1 only. Add an M/M/c comparison (one shared queue beats separate queues) as an advanced toggle, and the "keep each server under 70%" marker. | 1 d | Medium |
| Replication | good | good | good | ok | No read-your-writes fix, no semi-synchronous mode, no lag shown in seconds. Add presets ("lag spike", "failover during a write") and a "read from the primary after you write" option. Note on split brain. | 1.5 d | Medium |
| Sharding | good | good | good | good | Measured claims hold (surname at 6 shards leaves one shard with 7 of 600 users). Gap: "lookup table" shows a perfect 1.00 because weights are known in advance; real traffic moves. Add a "traffic changes after placement" button and a single super-hot user that no strategy can split. | 1 d | Low |
| Message queue | good | ok | good | ok | The "held back by back pressure" counter just disappears; the page says the work is "pushed upstream" but the model never shows where it went. Add a producer-side backlog, or a reject-and-retry mode with backoff. | 1.5 d | High |
| DNS | good | ok | ok | ok | TTL is discussed on the page but cannot be tried. Add "time passes" and "change the record" so stale answers appear after a change. | 1 d | Medium |
| CDN | good | ok | good | ok | No hit-ratio or "requests that never reached the origin" counter, which is the number that justifies a CDN. Add it, plus versioned URLs as the alternative to purging. | 1 d | Medium |
| TCP vs UDP | ok (A.1 #10) | good | ok | ok | Add QUIC / HTTP/3 as the third lane, and a congestion-window toy only if it stays simple. | 1.5 d | Low |
| CAP | ok (A.1 #9) | good | good | ok | Add PACELC (latency vs consistency when there is no partition), and a quorum lab (N, R, W sliders, R + W > N). The quorum lab is a natural new lab. | 2 d | Medium |
| Scaling story | good | good | good | good | Show rough users and QPS at each stage (ties to the estimator), and a "what would you do first?" scoring in predict mode. | 1 d | Low |

### A.3 Cross-cutting findings

1. **Only three topics have quizzes** (cache, database, load balancer), and all three are marked `reviewed: false`. No lab links to a quiz. Proposal: two or three questions at the end of each lab, reusing the quiz format.
2. **Playback controls are inconsistent.** Cache has play/step, load balancing has play/pause, queue has play/pause, the rest have none. Build one shared player in `lab-kit.ts` (play, pause, step, speed, reset). The Advanced Databases animations need it anyway, so build it once, there.
3. **Accessibility tests only cover each page in its default state.** Add axe checks after interaction (after a crash in replication, after a partition in CAP, and so on), as was done for quizzes.
4. **Reduced motion:** the queue and load-balancing labs handle it; the cache lab only moves when pressed, which is fine. The shared player should default to paused with reduced motion.
5. **Presets and challenges.** Only the estimator has presets. Add "scenario" buttons to every lab ("viral spike", "a node dies") and one measurable goal per lab.
6. **"What the model leaves out"** is missing on the estimator, consistent hashing, cache eviction, load balancing.

Total for A.2 and A.3 enhancements: about **18 days** if everything is done. I would do the High items (load balancing, message queue) and the cross-cutting player first, about **7 days**, and leave the rest for later.

---

## Part B. The "Advanced Databases" section

### B.1 The engine decision (needs your approval)

**A correction to the premise first.** The prompt assumed PGlite gives "real plans and locks". Plans, yes. Locks between two sessions, no: PGlite's own documentation says it "only has a single exclusive connection", and its README says it uses Postgres single-user mode because the WebAssembly build cannot fork processes. So **two transactions blocking or deadlocking each other cannot run live in the browser**.

Facts I checked (npm registry and the PGlite docs, today):

| | PGlite | sql.js (SQLite) / official sqlite-wasm | Recorded output only |
|---|---|---|---|
| What it is | Postgres compiled to WebAssembly, Apache-2.0 | SQLite compiled to WebAssembly | Static JSON from a real run |
| Version | 0.5.9 | sql.js 1.14.2; sqlite-wasm 3.53.4 | n/a |
| Size | Docs say "under 3 MB gzipped" for the core. The npm package is 25.6 MB unpacked because it ships many builds and extensions, so the real transfer must be **measured** (Phase 0 spike) | sqlite-wasm is 3.0 MB unpacked; sql.js is 24 MB unpacked (many builds) | 0 |
| Postgres major version | Not stated in the docs. We read it with `SELECT version()` in the spike and print it on every page | n/a | n/a |
| `EXPLAIN (ANALYZE, BUFFERS)` | Real Postgres planner and executor | SQLite has `EXPLAIN QUERY PLAN` only: no timings, no row estimates, no buffers | Real, but fixed |
| Stored functions, triggers, views, CTEs, window functions, partitioning | Yes (it is Postgres; PL/pgSQL to be confirmed in the spike) | Views, triggers, CTEs, windows yes; no stored procedures; no declarative partitioning | Shown, not runnable |
| Two sessions, locks, deadlocks | **No** (single connection) | No (file-level write lock) | Replayable |
| Works on GitHub Pages | Needs checking: it should not need the special headers that SharedArrayBuffer needs, which GitHub Pages cannot set. This is an explicit spike item | Yes | Yes |

**Recommendation: a hybrid.**

1. **PGlite, lazy-loaded, for everything a single session can show:** the playground, `EXPLAIN` and `EXPLAIN ANALYZE`, indexes, CTEs, window functions, views, functions, triggers, partitioning and pruning, planner statistics, and the exercises. It loads only when a learner opens a playground, in a Web Worker so the page never freezes.
2. **Recorded traces from a real multi-session Postgres for locks, deadlocks, isolation levels and MVCC across sessions.** A small script in `scripts/record-traces/` runs two real sessions against a real Postgres (Docker is installed on this machine, version 28.5.1; the Postgres 16 folder on `PATH` does not exist, so we would pull an image), saves what each session saw, what `pg_locks` showed and the exact timing order, and commits the JSON. The animation replays it. Each trace is stamped with the Postgres version and the date. The script is run by hand when content changes, not in CI, so the build never needs Docker or the network.
3. **Single-session MVCC and locking is still real in PGlite.** `xmin`, `xmax` and `ctid` are visible after an `UPDATE`, so the "row versions" animation can use live data. `pg_locks` shows the locks one transaction holds, so "which lock does `ALTER TABLE` take versus `SELECT`" can run live.
4. **Static pages embed a real run, not live JavaScript.** A build step runs the sample queries in PGlite under Node and writes the plan into the page. So the reading pages work without JavaScript and every number on them came from a real run. Timings vary by machine, so a page shows "measured on PGlite x.y, on <date>" and exercises never check timings, only plan shape.
5. **MySQL differences are written callouts, not run.** There is no engine for it. Each one is marked "not run here" and sourced from the MySQL manual.

Why not the others: SQLite cannot teach `EXPLAIN ANALYZE` (the core of the request) and differs from Postgres on locking and partitioning. Recorded-only loses the hands-on exercises, which is the point of the section.

### B.2 Site structure

A new top-level section **Databases** next to Learn, Labs, Interview, Practice and Reference. It needs a nav entry, a landing page, its own sidebar group and the existing page layout. Pages, in reading order, with their prerequisites (using the existing "Before this" system):

**Module 1. How data is stored and found**
1. How a database stores rows: pages, heap, the write-ahead log, bloat and VACUUM, B-tree vs LSM in one comparison. Before: `learn/database/`.
2. Indexes: how a B-tree works. **Animation:** search, insert, node split, range scan.
3. Index design: composite and the leftmost-prefix rule, covering, partial, unique, hash, and when an index hurts. **Animation:** composite index, which queries can use it.
4. Scan types: seq, index, index-only, bitmap. **Animation:** same rows, rows touched counted live.

**Module 2. Reading plans**
5. **EXPLAIN and EXPLAIN ANALYZE: the reading guide (the core page).** Annotated real plan, the red flags, and the method (innermost node out; find where time and rows jump; one hypothesis; change one thing; measure again). **Animation:** plan tree running node by node.
6. Join algorithms: nested loop, hash, merge. **Animation:** two tables, three algorithms.
7. Planner statistics: estimates vs actual rows, `ANALYZE`, why plans go wrong.

**Module 3. Writing faster SQL**
8. Query optimisation checklist (the cheat sheet page).
9. Pagination: OFFSET vs keyset. N+1 and batching.
10. CTEs, including recursive, and when they help or hurt.
11. Window functions and materialized views.
12. Views, functions, stored procedures and triggers, with trade-offs.

**Module 4. Concurrency**
13. Transactions and ACID.
14. Isolation levels and MVCC. **Animation:** which row version each transaction sees (live single-session `xmin`/`xmax`, plus recorded two-session traces).
15. Locks: row, table, advisory; lock waits; deadlocks. **Animation:** lock queue and deadlock detection (recorded trace).
16. Connection pooling (short).

**Module 5. Scaling a table**
17. Partitioning: range, list, hash; pruning; how it differs from sharding. **Animation:** which partitions a query touches (from real `EXPLAIN`).
18. Sharding: a short page that links to the existing sharding lab and consistent hashing lab.

**Practice area:** SQL playground, the exercise set, "read this plan" drills, interview-style questions, and the cheat sheet.

How it connects to what exists: `learn/database/` and the SQL-vs-NoSQL chooser are the entry points; the sharding, replication and consistent hashing labs are linked from the pages that touch them; quizzes and flashcards use the existing formats; progress is tracked by the existing store (pages read, exercises solved appear on the progress page).

### B.3 Animations

All run on one shared player (play, pause, step, speed, reset). Every step also writes one sentence into an `aria-live` log, so the animation has a text equivalent. With reduced motion the player starts paused and is step-driven. Keyboard: Space plays or pauses, arrow keys step. The logic for each is a pure TypeScript module that emits a list of step events, so it is unit tested like the existing simulations.

| Animation | Data source | Notes |
|-----------|-------------|-------|
| B-tree: search, insert, split, range scan | Pure model (`btree.ts`) | Small tree (fan-out 3 or 4) so the split is visible |
| Seq scan vs index scan | Model for the picture; **final counts from a real PGlite run** | Row count touched shown live |
| Composite index: which queries can use it | Model, with a real `EXPLAIN` beside it | Leftmost prefix, ranges, order |
| Join algorithms | Pure model | Three lanes over the same two tiny tables |
| Plan tree running node by node | **Real `EXPLAIN (ANALYZE, FORMAT JSON)` output**, live or embedded | Cost, rows and time per node; estimated vs actual highlighted |
| Two transactions interleaving, lock queue, deadlock | **Recorded trace** from real Postgres | Replay only |
| MVCC row versions | Live `xmin`/`xmax` in PGlite, plus recorded two-session traces | |
| Partition pruning | **Real `EXPLAIN`** on a partitioned table | Shows which partitions are scanned |

### B.4 The sample database and the playground

Schema (e-commerce, because everyone knows it): `users`, `categories`, `products`, `orders`, `order_items`, plus an `events` table for partitioning. Proposed size, to be confirmed by measuring generation time and memory in the spike: 100k users, 10k products, 500k orders, about 1.5M order items, 1M events. Data is generated with `generate_series` and a deterministic hash (never `random()`), so every learner and every test gets the same rows and the same plans. `ANALYZE` runs after loading.

Risks to measure, not assume: load time on a mid-range phone, memory limits on mobile Safari, and whether "millions of rows" is reasonable at all. If it is not, the fallback is about 200k rows plus an honest note that plans at larger sizes are shown from recorded runs.

Playground: editor, Run, `EXPLAIN` / `EXPLAIN ANALYZE` buttons, a results table with a row cap, a statement timeout and a Stop button (the worker is terminated), a Reset button that restores the seeded database, and the plan shown as the node-by-node view.

### B.5 Exercises

Format (YAML under `content/databases/exercises/`, in the same style as quizzes and practice, with the `reviewed` flag):

- `id`, `topic`, `difficulty` (1 to 3), `title`, `scenario` (one paragraph), `setup` (optional extra SQL), `starter` (the slow query), `hints` (three tiers), `solution`, `why` (why it was slow), `checks`.
- **Checks look at the plan and the result, never at text or time.** Examples: `uses: Index Scan on idx_orders_user`, `not: Seq Scan on orders`, `rows_removed_by_filter_lt: 1000`, `same_result_as: <expected result hash>`. The result check stops a learner "fixing" a query by deleting its WHERE clause.
- DDL such as `CREATE INDEX` is allowed in the sandbox, and Reset undoes it.
- A validator (`scripts/validate/exercises.mjs`) rejects missing hints, missing solutions, and bad check names.
- **A test runs every exercise in Node with PGlite:** the starter must fail its checks, the stated solution must pass them. This keeps the "every plan was actually run" rule true as versions change. Pin the PGlite version and update it deliberately.

Planned set (about 24 at full size, 12 for the first release), by topic: index choice and column order (4), covering and partial indexes (3), read-this-plan drills (5), join and statistics problems (3), pagination and N+1 (3), CTE and window rewrites (3), partition pruning (2), plus interview-style questions (3) answered in prose. Difficulty is spread over three levels.

### B.6 The plan-reading guide (core page) outline

1. One real plan, annotated line by line: node type, `cost=startup..total`, `rows` (estimate), `actual time`, `rows` (actual), `loops`, `Rows Removed by Filter`, `Buffers: shared hit/read`, `Planning Time` vs `Execution Time`.
2. Reading order: indent shows the tree; execution is innermost first; per-loop times are multiplied by `loops`.
3. Estimated vs actual: a factor of 10 or more is the first thing to chase.
4. Red flags, each with a real before-and-after: seq scan on a big table with a selective filter, estimate mismatch, sort or hash spilling to disk, nested loop over large inputs, a filter that removes almost every row it reads.
5. The method: hypothesis, one change, measure again. Then the "plan stepper" animation and three drills.

### B.7 Sources I intend to use (to be read and cited per page, not yet done)

- PostgreSQL documentation: *Using EXPLAIN*, *Indexes*, *Concurrency Control* (MVCC, isolation levels, explicit locking), *Table Partitioning*, *WITH Queries*, *Statistics used by the planner*, *Routine Vacuuming*, the `pg_locks` view, `CREATE INDEX`, window function tutorial.
- PGlite documentation (engine behaviour and limits).
- *Use The Index, Luke* for index design concepts, as a second source.
- MySQL reference manual for every MySQL-difference callout.

Each page ends with its source list. All explanatory text is written fresh; nothing is copied from those sources.

---

## Phases, effort and acceptance

Estimates are for one developer working alone, in days, and are rough.

| Phase | Work | Effort | Acceptance (all must pass) |
|-------|------|--------|----------------------------|
| 0 | Part A.1 fixes, plus the **engine spike**: measure PGlite transfer size, time to start, seed time and memory, check that it works on GitHub Pages, in a worker, on a phone-sized viewport, and read `version()` | 3 + 2 | Unit tests for items 3 and 9; strict build; spike report with measured numbers and a go/no-go |
| 1 | Part A improvements, High items and the shared player | 7 | Player has play/pause/step/speed/reset, keyboard, reduced-motion behaviour; e2e on desktop and 375 px; axe after interaction |
| 2 | Foundations: section scaffolding, nav, content types, exercise validator, PGlite worker wrapper, seed script, plan-embedding build step, feature flag `advancedDb` (off until reviewed) | 5 | Section builds dormant behind the flag; validator tests; a Node test seeds the database and checks table counts |
| 3 | Core: modules 1 and 2 pages 1 to 5, B-tree, scan, composite and plan-stepper animations, the playground | 9 | Every embedded plan comes from a real run; animations unit tested and e2e tested; axe light and dark on every new page |
| 4 | Exercises MVP (12) and the checker | 7 | Every exercise: starter fails, solution passes (Node test); result-equality check blocks WHERE-deleting; Reset works; Stop works |
| 5 | Joins, statistics, optimisation checklist, pagination, N+1 | 6 | Join animation tested; exercises added; cheat sheet page |
| 6 | Concurrency: transactions, MVCC, locks, deadlocks; trace recorder; replay player | 8 | Traces validate against a schema; version stamp shown; replay matches the recorded order; a doc explains how to re-record |
| 7 | CTEs, windows, views/functions/procedures/triggers, partitioning with pruning view, pooling, storage | 7 | Pruning view reads real `EXPLAIN`; each page lists sources |
| 8 | Quizzes, flashcards, interview questions, search, progress integration, final accessibility and mobile pass, content review, remove the flag | 5 | Strict build, all unit and e2e tests, axe including contrast on every new page in both themes and both viewports |

Total about **55 days** for the full section; the first useful release (phases 0 to 4) is about **26 days**. Phase 1's remaining Part A items (the other 11 days) can run in between.

### Risks

| Risk | Why it matters | Mitigation |
|------|----------------|------------|
| Size and speed of WebAssembly Postgres on phones | Could make the playground unusable on mobile | Lazy load, worker, measured in phase 0; recorded-run fallback |
| Mobile memory with millions of rows | Out-of-memory crash | Smaller dataset if measured necessary; say so on the page |
| Plans change between Postgres versions | A page shows a plan the engine no longer produces | Pin the version; the Node test re-runs every shown plan; the page shows the version |
| Learners on MySQL see differences | Advice does not transfer | Labelled callouts, sourced, marked "not run here" |
| Content accuracy | This is the highest-risk topic for confident mistakes | Every claim runs or cites a primary source; `reviewed` flag; second review before the flag is removed |
| GitHub Pages cannot set special headers | Some WebAssembly features need them | Verified in the spike before anything else is built |
| Test time grows | The every-page axe test already takes about 5 minutes | Run the new pages in a separate project, or split by section |

## Open questions for you

1. **Engine:** do you approve the hybrid (PGlite for everything single-session, recorded real traces for locks and deadlocks)? The alternative is to drop live lock demos entirely.
2. **Scope of the first release:** phases 0 to 4 (indexes, plan reading, playground, 12 exercises), or should concurrency come earlier?
3. **Placement:** a new top-level "Databases" section as proposed, or a group under Learn?
4. **Dataset size:** are you happy to let the spike decide (target 1M rows, fall back to 200k)?
5. **Recording traces:** is it fine to use Docker here to pull a Postgres image once, and commit the recorded traces?
6. **Part A priority:** fix A.1 and the High items first (about 10 days) before starting Part B, or interleave?
7. **Dormant first:** keep the section behind a feature flag until reviewed, as with earlier features?
8. **Anything to cut:** my list is long. The ones I would cut first are the hash index detail, connection pooling and the LSM comparison, in that order.
