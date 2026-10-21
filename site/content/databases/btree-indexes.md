An index is a second, smaller structure kept next to the table that lets the database find rows without reading every page. PostgreSQL's default, and by far the most common, is the **B-tree**. It keeps keys sorted, it stays shallow however much data it holds, and it answers equality, ranges and sorted output with the same structure.

<div data-widget="btree"></div>

## Without an index

To find one customer's orders, the database has no choice but to read the whole table and test every row:

```sql explain-analyze
select * from orders where user_id = 42;
```

`Seq Scan on orders` read every page of the table (`Buffers` counts pages), and `Rows Removed by Filter` shows almost 100,000 rows were read only to be thrown away. In PostgreSQL 18, `EXPLAIN ANALYZE` reports buffers by default.

## With an index

```sql setup
create index orders_user_id_idx on orders (user_id);
```

```sql explain-analyze
select * from orders where user_id = 42;
```

The plan now starts from the index. The number of pages read drops by more than an order of magnitude, and nothing is read just to be discarded. (Why a *bitmap* scan here rather than a plain index scan is the subject of [scan types](site:databases/scan-types/).)

### At production scale

With 100,000 orders even the slow plan above takes milliseconds, so the difference is easy to shrug off. Here is the same query on the same shop generated 100 times larger, recorded on a real PostgreSQL server:

<div data-widget="db-scale" data-id="btree-at-scale"></div>

Without the index the server read every one of the table's 80,906 pages to return 525 rows. That took 214 ms even though it split the scan across three processes (`Gather` and `Parallel Seq Scan`: a server runs big scans in parallel, which the in-browser engine cannot). With the index it read 526 pages and finished in under a millisecond. The gap grows with the table, because a full scan reads every page and the index reads only the pages that hold matching rows.

Two more things differ from the small database. The estimate (`rows=18`) is well below the 525 rows found, because on a table this size `ANALYZE` reads a sample (30,000 rows by default) instead of every row. And the `JIT` lines show the server compiling parts of an expensive query to machine code; the in-browser engine has no JIT.

## How it stays fast

- **Sorted pages.** Each page holds keys in order. Inner pages hold boundaries and point down to the page that covers a range of keys; leaf pages hold every key, each with the address of its row.
- **Shallow.** A real page holds hundreds of keys, so each level multiplies the reach by hundreds. Three or four levels cover hundreds of millions of rows, which means a lookup reads three or four index pages. In the animation the pages hold three keys so that you can see the splits.
- **Always balanced.** When a page fills up it splits in two and passes a boundary key up to its parent. The tree only grows taller when the root itself splits, so every leaf is always the same distance from the root.
- **Linked leaves.** Each leaf points to the next one, so a range is one descent followed by a walk sideways. That also makes `ORDER BY` on the indexed column free: the rows come out sorted.

```sql explain-analyze
select id, user_id, created_at from orders
where user_id between 100 and 110
order by user_id
limit 10;
```

No `Sort` node: the index already returns rows in `user_id` order, so the database reads entries from the start of the range and stops after ten. `Index Searches: 1` (new in PostgreSQL 18) confirms a single descent served it.

Take the `LIMIT` away and the plan changes: the same range matches a few hundred orders scattered across the table, and the planner prefers to collect them with a [bitmap scan](site:databases/scan-types/) and sort them afterwards. Sorted order from an index is free, but it is only one of the costs the planner weighs.

## What a B-tree can answer

A B-tree helps when a query compares an indexed column using `=`, `<`, `<=`, `>`, `>=`, `BETWEEN`, `IN`, or `IS NULL`, and when it sorts by the indexed column (in either direction). A pattern match like `LIKE 'abc%'` can also use one, but only when the index uses the `C` collation or a pattern operator class such as `text_pattern_ops`; a pattern that starts with a wildcard, `LIKE '%abc'`, cannot.

It does not help when the column is wrapped in a function or expression the index was not built on: an index on `email` does nothing for `where lower(email) = …`. That needs an [expression index](site:databases/index-design/).

## What it costs

```sql run
select pg_size_pretty(pg_relation_size('orders_user_id_idx')) as index_size,
       pg_size_pretty(pg_relation_size('orders')) as table_size;
```

- **Space.** Every index is another structure on disk and in memory.
- **Writes.** Every `INSERT` adds an entry to every index on the table, and an `UPDATE` that changes an indexed column (or cannot be done as a [HOT update](site:databases/how-rows-are-stored/)) must touch the indexes too. A table with ten indexes pays for ten extra writes per insert.
- **Choice.** The planner may still decide a full scan is cheaper, for example when a large share of the rows match. See [designing indexes](site:databases/index-design/).

## Try it yourself

Each exercise runs on the same sample database. Your changes are made inside a transaction and undone after every check, so you cannot break anything.

<div data-widget="sql-exercise" data-id="orders-for-one-user"></div>

## In MySQL

*Not run here; from the MySQL reference manual.* InnoDB indexes are also B+trees. Because an InnoDB table is itself the primary-key B-tree, a secondary index entry holds the primary key rather than a row address, so a lookup through a secondary index is followed by a search of the primary key. Keeping the primary key short keeps every secondary index small.

## Sources

- PostgreSQL documentation: [*Indexes*](https://www.postgresql.org/docs/18/indexes.html) (Introduction, Index Types, Indexes and ORDER BY), [*B-Tree Indexes*](https://www.postgresql.org/docs/18/btree.html) (implementation), [*Operator Classes and Operator Families*](https://www.postgresql.org/docs/18/indexes-opclass.html), [*Using EXPLAIN*](https://www.postgresql.org/docs/18/using-explain.html).
- [*Use The Index, Luke*](https://use-the-index-luke.com/) by Markus Winand, chapter "[Anatomy of an Index](https://use-the-index-luke.com/sql/anatomy)".
- MySQL reference manual: [*Clustered and Secondary Indexes*](https://dev.mysql.com/doc/refman/8.4/en/innodb-index-types.html).
