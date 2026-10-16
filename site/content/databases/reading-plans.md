`EXPLAIN` shows the plan the database chose for a query. `EXPLAIN ANALYZE` runs the query and shows what each step really did. Reading that output is the single most useful skill for making a query fast, because it replaces guessing with evidence: where the time went, how many rows each step produced, and how wrong the planner's guesses were.

## A real plan, step by step

Revenue by category for December 2024, the five biggest. Step through it below; each step is one node, in the order the database runs them.

```sql plan-tree
select c.name, sum(oi.qty * oi.price) as revenue
from orders o
join order_items oi on oi.order_id = o.id
join products p on p.id = oi.product_id
join categories c on c.id = p.category_id
where o.created_at >= '2024-12-01'
group by c.name
order by revenue desc
limit 5;
```

## Reading one line

Every node prints a line like this, followed by details:

```text
Seq Scan on orders  (cost=0.00..2060.00 rows=44 width=27) (actual time=0.600..14.100 rows=44.00 loops=1)
```

| Part | What it means |
|---|---|
| `Seq Scan on orders` | The kind of step, and the table or index it works on. |
| `cost=0.00..2060.00` | The planner's estimate, in abstract units: the cost before the first row can be returned, then the cost of returning all rows. Units are relative to reading one page in sequence (1.0). Compare costs between plans for the same query, never with milliseconds. |
| `rows=44` (first) | How many rows the planner **expected** this node to produce, per loop. |
| `width=27` | The expected average row size in bytes. |
| `actual time=0.600..14.100` | Measured milliseconds: until the first row, and until the last, **per loop**. |
| `rows=44.00` (second) | How many rows it **really** produced, per loop. PostgreSQL 18 prints this with decimals because it is an average over loops. |
| `loops=1` | How many times the node ran. Inside a nested loop the inner side runs once per outer row, so multiply time and rows by `loops`. |

Lines underneath add detail. The ones worth knowing:

- **`Filter`** and **`Rows Removed by Filter`**: a condition tested *after* reading each row, and how many rows it discarded. A large number here means rows were read for nothing.
- **`Index Cond`**: a condition the index itself satisfied, without reading rows that fail it. That is what you want to see.
- **`Recheck Cond`** and **`Heap Blocks`**: in a bitmap scan, the condition re-checked on each fetched row, and how many table pages were read.
- **`Heap Fetches`**: in an index-only scan, how often the table still had to be visited.
- **`Index Searches`** (PostgreSQL 18): how many times the index was descended. More than one means an `IN` list or a skip scan.
- **`Buffers: shared hit=… read=…`**: pages found already in memory (`hit`) and pages read in from the operating system (`read`). Together they are the work done, and unlike time they barely change between runs. `temp read/written` means the step ran out of memory and used temporary files. Since PostgreSQL 18, `EXPLAIN ANALYZE` includes buffers without being asked.
- **`Sort Method`**: `quicksort` in memory, `top-N heapsort` when a `LIMIT` lets it keep only the best rows, or `external merge  Disk: …` when the sort spilled to disk.
- **`Planning Time`** and **`Execution Time`** at the bottom: total time to choose the plan and to run it.

`EXPLAIN ANALYZE` really runs the statement. For an `UPDATE` or `DELETE`, wrap it in `BEGIN; … ROLLBACK;` so nothing is changed.

## Reading order

A plan is a tree printed with the root at the top. **Work happens from the inside out**: the most indented nodes read the tables and pass rows up through joins, sorts and aggregates to the root. Read it bottom-up, or use the stepper above, which walks the nodes in that order. One detail: a `Hash Join` first builds its hash table from its second child (the `Hash` node) and only then reads its first child, so the stepper visits the `Hash` side first.

## The red flags

### Reading far more rows than are kept

```sql explain-analyze
select id, total from orders where user_id = 42;
```

`Seq Scan` with `Rows Removed by Filter` near the size of the table: nearly all the work was thrown away. The fix is usually an [index](site:databases/btree-indexes/) on the filtered column.

### The estimate is far from the truth

The planner chooses joins, scan types and memory by its row estimates. When an estimate is off by ten times or more, the plan built on it is often bad. A common cause is a condition the statistics cannot see through, such as arithmetic on a column. Orders over 2,400 including 18% tax:

```sql explain-analyze
select count(*) from orders where total * 1.18 > 2400;
```

The planner has statistics for `total`, not for `total * 1.18`, so it falls back to a fixed guess for the fraction of rows matching. Moving the arithmetic to the other side lets it use the column's histogram:

```sql explain-analyze
select count(*) from orders where total > 2400 / 1.18;
```

Other causes: statistics older than a big change to the data (run `ANALYZE`), correlated columns whose selectivities the planner multiplies as if they were independent (see `CREATE STATISTICS`), and joins whose estimates compound.

### A sort that spills to disk

```sql explain-analyze
select order_id, product_id, price from order_items order by price desc, order_id;
```

`Sort Method: external merge  Disk: …` and `temp written` mean the sort did not fit in `work_mem` (4 MB by default), so it wrote temporary files. Options: sort fewer rows (filter first, or add a `LIMIT` so a top-N sort is enough), return the rows already in order from an index, or raise `work_mem` for that session if the memory is really available.

### A nested loop with a big outer side

A `Nested Loop` runs its inner side once per row from its outer side (`loops=` on the inner node). With an index lookup on the inner side and a few outer rows, it is the fastest join there is. With thousands of outer rows and a scan on the inner side, it multiplies the work. Look at `loops` and at the inner node's time multiplied by it.

## A method that works

1. **Get the real plan**: `EXPLAIN (ANALYZE, BUFFERS)` on realistic data, not an empty development table.
2. **Find where the time and the pages go.** Start from the inner nodes and look for the one whose own time, or row count, jumps.
3. **Compare estimated and actual rows** at each node. Fix bad estimates first; a good plan needs good numbers.
4. **Form one hypothesis**: "it reads the whole table because there is no index on `user_id`".
5. **Change one thing**, then explain again and compare buffers and rows, not only milliseconds.

Practise on the [playground](site:databases/playground/), where **Explain analyze** runs any query against the same data as these examples.

## Other useful options

`EXPLAIN` alone (without `ANALYZE`) shows the plan without running the query, which is safe on anything. `VERBOSE` adds output columns and schema-qualified names. `SETTINGS` lists planner settings that differ from the defaults. `FORMAT JSON` gives a machine-readable tree, which is what the stepper on this page uses. PostgreSQL 17 added `SERIALIZE` (the cost of converting the result for the client) and `MEMORY` (the planner's memory use).

## Try it yourself

Each exercise runs on the same sample database. Your changes are made inside a transaction and undone after every check, so you cannot break anything.

<div data-widget="sql-exercise" data-id="subquery-per-row"></div>

<div data-widget="sql-exercise" data-id="stale-statistics"></div>

<div data-widget="sql-exercise" data-id="sort-spills"></div>

## In MySQL

*Not run here; from the MySQL reference manual.* `EXPLAIN` in MySQL prints one row per table by default, with columns such as `type` (`ALL` means a full scan), `key`, `rows` and `Extra`. `EXPLAIN FORMAT=TREE` prints a tree closer to PostgreSQL's, and `EXPLAIN ANALYZE` (since 8.0.18) runs the query and adds actual times, rows and loops to each node.

## Sources

- PostgreSQL documentation: *Using EXPLAIN* (including *EXPLAIN ANALYZE* and *Caveats*), *EXPLAIN* (command reference), *Statistics Used by the Planner*, *Resource Consumption* (`work_mem`), *CREATE STATISTICS*; PostgreSQL 17 and 18 release notes.
- MySQL reference manual: *EXPLAIN Statement*, *Obtaining Information with EXPLAIN ANALYZE*.
