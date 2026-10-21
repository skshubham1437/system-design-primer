"Is there an index?" is the wrong question. The planner can reach the same rows in several ways, and it picks by estimating how much each one would cost. Knowing the options, and what makes each one expensive, is what lets you read a plan and predict what a change will do.

<div data-widget="scan-compare"></div>

## The four ways to read a table

- **Sequential scan.** Read every page in order and test every row. It reads more than it needs, but reading pages in order is the cheapest kind of reading there is, and it is the best plan when a large share of rows match.
- **Index scan.** Walk the index and fetch each matching row as its entry comes up. Ideal for a few rows, or when the rows must come out in index order. It gets expensive when many rows match and they are spread across the table, because each fetch can land on a different page.
- **Bitmap scan.** Walk the index first and only note where the matching rows live, then sort those locations by page and read each page once. It is the middle ground for "more than a few, less than most" rows. In a plan it appears as a `Bitmap Index Scan` feeding a `Bitmap Heap Scan`.
- **Index-only scan.** Answer from the index alone, when it contains every column the query needs and the table pages are known to be all-visible.

## How the planner chooses

The planner estimates two things: **how many rows will match** (from statistics gathered by `ANALYZE`) and **what reading them will cost**. Costs are in abstract units where reading one page in sequence costs `seq_page_cost` (1.0 by default) and reading one page out of order costs `random_page_cost` (4.0 by default). An index scan over many scattered rows adds up random reads quickly; a sequential scan pays a fixed price whatever matches.

One statistic decides a lot: the **correlation** between a column's order and the physical order of rows. Orders were inserted over time, so `created_at` follows the table's order almost perfectly, while `user_id` does not:

```sql run
select attname as column_name, round(correlation::numeric, 3) as correlation
from pg_stats
where tablename = 'orders' and attname in ('id', 'created_at', 'user_id', 'total')
order by attname;
```

```sql setup
create index orders_created_at_idx on orders (created_at);
create index orders_user_id_idx on orders (user_id);
```

A range on the well-correlated column touches neighbouring rows, so a plain index scan reads few pages:

```sql explain-analyze
select id, created_at from orders where created_at >= '2024-12-01';
```

A range on the uncorrelated column matches rows scattered across the whole table. Fetching them in index order would jump around, so the planner builds a bitmap and reads each page once:

```sql explain-analyze
select id, user_id from orders where user_id between 100 and 300;
```

Look at `Heap Blocks`: about 5% of the rows match, yet they sit on almost every page of the table, so even the bitmap scan reads nearly all of it. The fraction of *pages* touched matters more than the fraction of rows. A little wider and a sequential scan would win.

When the index holds every column the query needs, the table hardly has to be visited. `Heap Fetches` counts the rows that still had to be checked in the table, because their page was not yet marked all-visible by `VACUUM`; on a settled table it stays near zero:

```sql explain-analyze
select count(*) from orders where user_id between 100 and 300;
```

And when most of the table matches, none of the index paths is worth it:

```sql explain-analyze
select count(*) from orders where created_at >= '2023-03-01';
```

## What to take from it

- A sequential scan is not a bug. On a small table, or when most rows match, it is the right plan.
- The same index can lead to an index scan, a bitmap scan or no use at all, depending on **how many rows** match and **where they live**.
- The planner works from estimates. When a plan looks wrong, compare its estimated rows with the actual rows before anything else; that is the first step in [reading a plan](site:databases/reading-plans/).

## Try it yourself

Each exercise runs on the same sample database. Your changes are made inside a transaction and undone after every check, so you cannot break anything.

<div data-widget="sql-exercise" data-id="who-bought-a-product"></div>

<div data-widget="sql-exercise" data-id="deep-pagination"></div>

<div data-widget="sql-exercise" data-id="events-in-a-month"></div>

## In MySQL

*Not run here; from the MySQL reference manual.* InnoDB's equivalents are a full table scan (`type: ALL` in `EXPLAIN`), range and ref lookups through an index, and covering index reads (`Using index`). Because rows are stored in primary key order, a range on the primary key is naturally a sequential read. MySQL has no bitmap heap scan; Multi-Range Read (`Using MRR`) plays a similar role by sorting row lookups before reading them.

## Sources

- PostgreSQL documentation: [*Using EXPLAIN*](https://www.postgresql.org/docs/18/using-explain.html), [*Planner Cost Constants*](https://www.postgresql.org/docs/18/runtime-config-query.html#RUNTIME-CONFIG-QUERY-CONSTANTS) (`seq_page_cost`, `random_page_cost`), [*Statistics Used by the Planner*](https://www.postgresql.org/docs/18/planner-stats.html), [*pg_stats*](https://www.postgresql.org/docs/18/view-pg-stats.html) (correlation), [*Index-Only Scans and Covering Indexes*](https://www.postgresql.org/docs/18/indexes-index-only-scans.html).
- MySQL reference manual: [*EXPLAIN Output Format*](https://dev.mysql.com/doc/refman/8.4/en/explain-output.html), [*Multi-Range Read Optimization*](https://dev.mysql.com/doc/refman/8.4/en/mrr-optimization.html).
