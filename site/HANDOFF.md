# Handoff: learning features and the Databases section

Branch `learning-features`. **Nothing has been pushed**: the user asked for local commits only. Every commit message ends with a `Co-Authored-By` line.

## Where things stand

The work follows [ADVANCED_DB_PLAN.md](ADVANCED_DB_PLAN.md), which the user approved ("do as per your recommendation"). The plan file also contains the Phase 0 spike report.

| Phase | State | Commit |
|---|---|---|
| 0. Fixes from the lab review | Done | `dee78cb` |
| 0. Engine spike (PGlite) | Done | `7612e66` |
| 1. Shared player; load-balancing failures and power of two choices; queue producer backlog | Done | `f2125f4` |
| 2. Databases foundations: seed, build-time runner, worker engine, playground, exercise format, validator and checker | Done | `08524cb` |
| 3. Core pages and animations | **Written and tested, not committed** | none |
| 4. Exercise widget and 12 exercises | Not started | none |
| 5 to 8 | Not started | none |

## Uncommitted Phase 3 work (in the working tree)

- Pages in `content/databases/`: `how-rows-are-stored.md`, `btree-indexes.md`, `index-design.md`, `scan-types.md`, `reading-plans.md`. They are registered in `DB_PAGES` and `PREREQS` in `scripts/site-map.mjs`.
- Tested models in `src/lib/db/`: `btree.ts`, `scans.ts`, `composite.ts`, `plan-steps.ts`. Their tests are in `tests/unit/db-models.test.ts`.
- `src/scripts/db-visuals.ts` has four widgets: `btree`, `scan-compare`, `composite-index` and `plan-tree`. They are registered in `widgets.ts` and styled in `visuals.css`.
- The runner (`scripts/lib/db-runs.mjs`) has a new `plan-tree` block kind. It also now runs `vacuum` after each page so pages don't leak state into each other.
- `VACUUM ANALYZE` runs as a separate statement after the seed in the worker, the runner and the tests, because VACUUM cannot run inside a multi-statement string.
- `data/db-runs.json` holds the regenerated real outputs.

**Verified so far:**
- Strict content build passes.
- 243 unit tests pass and the typecheck is clean.
- `databases.spec.ts` and `lab-states.spec.ts` pass (64 tests, including axe in both themes).
- The widgets were checked by hand in the browser.

**Not yet run:** the full e2e suite after the last changes. The user stopped that run.

**Next steps:**
1. Run the full e2e suite.
2. Commit Phase 3.
3. Start Phase 4: the `sql-exercise` widget on top of `src/lib/db/exercise.ts`, plus 12 exercises. The format and validator already exist, and `db-engine.test.ts` proves each exercise fails as written and passes with its solution.

## Things to know before continuing

- **Engine:** PGlite 0.5.9, which is **PostgreSQL 18.6**. EXPLAIN ANALYZE prints buffers by default, and B-tree skip scan exists (`Index Searches: N`). The pages are written for PG 18 output.
- **Locks:** PGlite has a single connection. Lock and deadlock pages must use traces recorded from a real multi-session Postgres via Docker. That is Phase 6.
- **Real outputs only:** in a Databases page, `sql run / explain / explain-analyze / plan-tree / setup` blocks run at build time. Read the output before writing prose about it. Two of my claims were wrong until I checked them against real runs. Use `DB_RERUN=1` to run everything again.
- **Determinism:** the seed is UTC and `default_statistics_target = 1100`, so ANALYZE reads every row and estimates are identical on every machine.
- **Feature flag:** the section is behind `advancedDb` in `features.json`. It is on, and every page shows a Draft notice. Turn it off before pushing if the section should stay hidden.
- **File editing on Windows:** files use CRLF line endings and Python's default encoding is cp1252. Edit with the Edit tool, or the line-ending-aware patch script kept in the session scratchpad.
- **Browser pane conflicts:** stop the preview server before running Playwright, because both use port 4321.
- **Unrelated change in Phase 0:** CI now runs `npm run typecheck`.

## Running it

```bash
cd site && npm run build && npm run preview
```

Then open http://localhost:4321/databases/.
