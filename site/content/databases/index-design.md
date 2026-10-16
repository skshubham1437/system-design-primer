Knowing how a B-tree works is half the job. The other half is choosing *which* indexes to build: which columns, in which order, covering which rows. A good index matches the queries you actually run; a bad one costs space and write time and is never used.

## Column order in a composite index

An index on several columns sorts by the first column, then by the second within each value of the first, like a phone book sorted by surname and then first name. That order decides which queries can use it.

<div data-widget="composite-index"></div>

```sql setup
create index users_country_status_idx on users (country, status);
```

A query that fixes the leading column reads one contiguous slice of the index:

```sql explain-analyze
select id from users where country = 'DE' and status = 'banned';
```

A query on the second column alone cannot read one slice, because the matching entries are spread through every country. The long-standing rule was that such a query cannot use the index. **PostgreSQL 18 relaxed it** with *skip scan*: when the leading column has few distinct values, the planner can jump to each value in turn and search inside it. The `Index Searches` line shows how many descents that took:

```sql explain-analyze
select id from users where status = 'banned';
```

Skip scan is a useful safety net, not a design goal. It costs one descent per distinct leading value, so it is only worth it when there are few of them. The practical rules still hold:

1. **Put columns compared with `=` first**, and a column compared with a range (`<`, `>`, `BETWEEN`) last. After a range, the following columns cannot narrow the slice.
2. **Put the column you filter on most often first**, so that one index serves several queries.
3. **Match `ORDER BY` too.** An index on `(user_id, created_at)` serves `where user_id = ? order by created_at desc` with no sort at all.

## Covering indexes and index-only scans

If every column a query needs is in the index, the database can answer from the index alone, an **index-only scan**. `INCLUDE` adds columns to the leaf entries without making them part of the sort key, so they can be returned but not searched.

```sql setup
create index orders_user_created_idx on orders (user_id, created_at) include (total);
```

```sql explain-analyze
select created_at, total from orders
where user_id = 42
order by created_at desc
limit 10;
```

`Heap Fetches: 0` means the table was not visited at all. That only works for pages that `VACUUM` has marked *all-visible*; on a table with many recent changes, an index-only scan still has to check the table for those pages, and `Heap Fetches` goes up.

## Partial indexes

A partial index only contains the rows that match a condition. When queries always ask for a small subset, such as the 4% of orders that are still pending, the index can be a fraction of the size of a full one.

```sql setup
create index orders_pending_idx on orders (created_at) where status = 'pending';
```

```sql explain-analyze
select id, created_at from orders
where status = 'pending'
order by created_at
limit 20;
```

```sql setup
create index orders_created_all_idx on orders (created_at);
```

```sql run
select pg_size_pretty(pg_relation_size('orders_pending_idx')) as pending_only,
       pg_size_pretty(pg_relation_size('orders_created_all_idx')) as all_orders;
```

The same column, indexed for every order and for pending orders only.

The planner only uses a partial index when it can prove the query's condition implies the index's condition, so the `where status = 'pending'` has to be in the query.

## Indexes on expressions

An index on a column does not help a query that applies a function to the column. Index the expression instead:

```sql setup
create index users_email_lower_idx on users (lower(email));
```

```sql explain-analyze
select id, email from users where lower(email) = 'user77@example.com';
```

Notice the estimate in that plan. The planner only learns how values of a new expression are distributed when the table is next analysed, so until then it guesses.

## Unique indexes

A unique index refuses a second row with the same key, which is how `PRIMARY KEY` and `UNIQUE` constraints are enforced. The sample `users.email` column has one:

```sql run
select indexname, indexdef from pg_indexes where tablename = 'users' order by indexname;
```

## When an index is not used, or hurts

**When most rows match.** Following an index means jumping between pages; reading the whole table in order is cheaper once a large share of rows qualify. With an index on `status`, the rare value uses it and the common one does not:

```sql setup
create index orders_status_idx on orders (status);
```

```sql explain
select * from orders where status = 'refunded';
```

```sql explain
select * from orders where status = 'delivered';
```

**When the query hides the column.** `where created_at::date = '2024-06-01'` or `where total * 1.2 > 100` cannot use a plain index on `created_at` or `total`. Rewrite the condition so the bare column is compared with a value (`where created_at >= '2024-06-01' and created_at < '2024-06-02'`), or index the expression.

**When it is never read.** Every index slows down every insert and many updates. `pg_stat_user_indexes.idx_scan` counts how often each index has been used since statistics were reset; one that stays at zero on a busy production system is a candidate to drop.

**Hash indexes** support equality only. They are crash-safe since PostgreSQL 10, but a B-tree is almost always just as good and also supports ranges and sorting, so reach for a hash index only after measuring.

## A checklist

1. Start from the slow query and its plan, not from the table.
2. Index the columns in `WHERE` and `JOIN … ON`, equality columns first.
3. Add the `ORDER BY` columns if that removes a sort.
4. Consider `INCLUDE` for a hot query, a partial index for a hot subset, an expression index for a hot expression.
5. Check the plan again. Then check that writes are still fast enough.

## Try it yourself

Each exercise runs on the same sample database. Your changes are made inside a transaction and undone after every check, so you cannot break anything.

<div data-widget="sql-exercise" data-id="login-by-email"></div>

<div data-widget="sql-exercise" data-id="signups-on-a-day"></div>

<div data-widget="sql-exercise" data-id="recent-pending-orders"></div>

<div data-widget="sql-exercise" data-id="order-history-covering"></div>

<div data-widget="sql-exercise" data-id="newest-signups-by-country"></div>

## In MySQL

*Not run here; from the MySQL reference manual.* MySQL has composite, covering and unique indexes, functional (expression) indexes since 8.0.13, and a skip scan access method since 8.0.13. It has **no partial indexes**. Every InnoDB secondary index implicitly contains the primary key columns, which is why queries that only need the primary key are often covered for free.

## Sources

- PostgreSQL documentation: *Multicolumn Indexes*, *Index-Only Scans and Covering Indexes*, *Partial Indexes*, *Indexes on Expressions*, *Unique Indexes*, *Examining Index Usage*, *CREATE INDEX*; PostgreSQL 18 release notes (B-tree skip scan).
- *Use The Index, Luke*: "Concatenated Indexes", "Partial Indexes", "Functions".
- MySQL reference manual: *Multiple-Column Indexes*, *Functional Key Parts*, *Skip Scan Range Access Method*.
