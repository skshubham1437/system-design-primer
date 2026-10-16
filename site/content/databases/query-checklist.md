A one-page method for a slow query, and a table that maps what you see in a plan to its usual causes and fixes. Every row of the table links to the page that explains it with real plans.

## The method

1. **Measure the real thing.** `EXPLAIN (ANALYZE, BUFFERS)` on production-like data, with the same parameters the application uses. An empty development table says nothing about a table of fifty million rows. (In PostgreSQL 18, `ANALYZE` alone already reports buffers.)
2. **Find the expensive node.** Read from the innermost nodes outwards. Look for the node whose own time, rows or buffers jump. The [plan stepper](site:databases/reading-plans/) does this for you.
3. **Check the estimates first.** If estimated and actual rows differ by ten times or more, fix that before anything else: the rest of the plan was chosen on that number.
4. **Name one cause.** "It reads the whole table because the condition wraps the column in a function" is a hypothesis you can test. "It is slow" is not.
5. **Change one thing, measure again.** Compare buffers and rows, not only milliseconds; timings move with caches and load, page counts barely do.
6. **Check the cost of the fix.** A new index makes writes slower and takes space. `SET work_mem` for one report is fine; for the whole server it can exhaust memory.

## What you see, and what it usually means

| In the plan | Usual cause | Usual fix | Read more |
|---|---|---|---|
| `Seq Scan` on a big table, large `Rows Removed by Filter` | No index on the filtered column | Add an index on it | [B-tree indexes](site:databases/btree-indexes/) |
| An index exists but is not used; the condition appears as `Filter` | A function, cast or arithmetic on the column | Compare the bare column with a value or range, or index the expression | [Designing indexes](site:databases/index-design/) |
| `Sort` above an index scan on the same table | Index columns do not match `ORDER BY` | Index (equality columns, then sort columns) | [Designing indexes](site:databases/index-design/) |
| `Bitmap Heap Scan` with `Heap Blocks` close to the table size | Matching rows spread over most pages | Fine if most rows match; otherwise a more selective or covering index | [Scan types](site:databases/scan-types/) |
| `Index Only Scan` with large `Heap Fetches` | Pages not marked all-visible | `VACUUM` the table; check autovacuum keeps up | [How a table is stored](site:databases/how-rows-are-stored/) |
| Estimated rows far from actual rows | Stale statistics, correlated columns, expressions | `ANALYZE`; `CREATE STATISTICS`; rewrite the expression | [Planner statistics](site:databases/statistics/) |
| `Nested Loop` with huge `loops` on the inner side | Outer side underestimated, or no index on the inner join key | Fix the estimate; index the join key | [Joins](site:databases/joins/) |
| `Hash` with `Batches` greater than 1, or `temp written` | Not enough `work_mem` for the hash or sort | Join or sort fewer rows; raise `work_mem` for that query | [Joins](site:databases/joins/) |
| `Sort Method: external merge  Disk` | Sort larger than `work_mem` | Add `LIMIT`, return rows from an index already in order, or raise `work_mem` locally | [Reading EXPLAIN](site:databases/reading-plans/) |
| `Append` scanning every partition | The condition does not compare the partition key directly | Write a range on the bare partition key | [Tuning exercises](site:databases/tuning-exercises/) |
| Fast query, slow page | Many small queries (N+1), or OFFSET pagination | One query with a join or `= any(array)`; keyset pagination | [Pagination and N+1](site:databases/pagination-and-n-plus-one/) |
| `SubPlan` running once per row | Correlated subquery in the select list | Rewrite as a join, or index what it looks up | [Tuning exercises](site:databases/tuning-exercises/) |

## Before you add an index

- Is the query actually frequent or important? One slow nightly report may not be worth slowing every insert.
- Could an existing index serve it if its columns were in a different order, or with one `INCLUDE`d column?
- Will the new index be selective? An index on a column where most rows share one value is rarely used.
- After adding it, check `pg_stat_user_indexes.idx_scan` later: is it being used?

## Things that are not the database's fault

Sometimes the plan is fine and the time goes elsewhere: too many round trips, fetching thousands of rows to show twenty, a connection opened per request instead of taken from a pool, or waiting on a lock held by another transaction. If `Execution Time` is small but the request is slow, look outside the plan.

## Sources

- PostgreSQL documentation: *Using EXPLAIN*, *Performance Tips*, *Statistics Used by the Planner*, *Examining Index Usage*, *Resource Consumption*.
- *Use The Index, Luke*, Markus Winand.
