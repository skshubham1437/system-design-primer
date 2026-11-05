Database questions that come up in system design and backend interviews. Try to answer each one out loud before you open it: the point is to practise explaining a trade-off, not to memorise a sentence. Every answer links to the page that shows it with real plans or recordings.

## Indexes and queries

<details>
<summary>A query that used to take 5 ms now takes 2 seconds. How do you investigate?</summary>

Get the real plan with `EXPLAIN (ANALYZE, BUFFERS)` on production-like data and parameters. Find the node where time or rows jump, and compare estimated with actual rows there. Common causes: a plan change after the data grew or statistics went stale (fix with `ANALYZE`), a missing or unusable index (a function on the column), a nested loop chosen on a bad estimate, or the query waiting on a lock rather than running (check `pg_stat_activity`). Change one thing and measure again. See [the checklist](site:databases/query-checklist/).
</details>

<details>
<summary>Why might the database ignore an index you just created?</summary>

Because a sequential scan is cheaper: many rows match, so jumping between pages through the index would read more. Or the query cannot use it: a function or cast on the column, a leading column of a composite index not constrained, a type mismatch, or a pattern that starts with a wildcard. Or statistics are stale and the estimate is wrong. See [designing indexes](site:databases/index-design/).
</details>

<details>
<summary>What is the difference between a clustered and a non-clustered index?</summary>

A clustered index stores the rows themselves in key order (InnoDB's primary key, SQL Server's clustered index). A non-clustered (secondary) index stores keys with a pointer to the row. PostgreSQL tables are heaps in insertion order and every index is secondary; `CLUSTER` reorders a table once but does not keep it ordered. In InnoDB, secondary indexes point to the primary key, so a long primary key makes every index bigger. See [how a table is stored](site:databases/how-rows-are-stored/).
</details>

<details>
<summary>How would you paginate a feed with millions of items?</summary>

Keyset (seek) pagination: `where (created_at, id) < (last_created_at, last_id) order by created_at desc, id desc limit 20`, with an index on `(created_at, id)`. It costs the same at any depth, unlike OFFSET, which reads and discards every skipped row, and it does not shift when new items arrive. The trade-off is no "jump to page 500". See [pagination](site:databases/pagination-and-n-plus-one/).
</details>

## Transactions and concurrency

<details>
<summary>Two users withdraw money from the same account at the same time. How do you keep the balance correct?</summary>

Do the arithmetic in the database in one statement with a guard (`update accounts set balance = balance - 50 where id = 1 and balance >= 50`, then check the affected row count), or lock the row with `SELECT … FOR UPDATE` before deciding, or use serializable isolation and retry on serialization failures. Reading the balance in the application and writing back a computed total loses updates. See [transactions](site:databases/transactions/).
</details>

<details>
<summary>Explain the isolation levels and which one you would use.</summary>

Read committed (PostgreSQL's default) sees the latest committed data at each statement; repeatable read keeps one snapshot for the whole transaction; serializable additionally aborts transactions that could not have run one after another. PostgreSQL never allows dirty reads. Most OLTP code is fine at read committed with single-statement updates or row locks; use repeatable read for consistent reports and serializable when invariants span rows, with retries. See [isolation levels](site:databases/isolation-and-mvcc/).
</details>

<details>
<summary>What is a deadlock and how do you avoid one?</summary>

Two transactions each hold a lock the other needs. The database detects the cycle and aborts one (PostgreSQL after `deadlock_timeout`, error 40P01). Avoid them by locking in a consistent order, keeping transactions short, and retrying the victim. See [locks and deadlocks](site:databases/locks-and-deadlocks/).
</details>

<details>
<summary>How would you build a job queue on a relational database?</summary>

A jobs table with a status column and an index on the pending rows (a partial index fits well). Workers claim jobs with `select … for update skip locked limit 1` inside a short transaction, so they never wait for each other, then mark the job done. At high volume, a dedicated queue may serve better; see [message queues](site:labs/message-queue/).
</details>

## Scale

<details>
<summary>The orders table has two billion rows and deleting old orders is slow. What do you do?</summary>

Partition it by time (for example monthly ranges on `created_at`). Queries that filter on time read only the relevant partitions, and removing old data becomes dropping or detaching a partition instead of a huge `DELETE` that writes WAL for every row and bloats the table. Primary keys must then include the partition key. See [partitioning](site:databases/partitioning/).
</details>

<details>
<summary>When would you shard, and what does it cost?</summary>

When writes or data size outgrow one server after tuning, caching and read replicas. Choose a shard key from the main access path (for example the customer id) so most queries hit one shard. Costs: cross-shard queries and transactions, rebalancing when shards are added, hot keys, and more systems to run. See [replicas and sharding](site:databases/sharding-and-scale/) and the [sharding lab](site:labs/sharding/).
</details>

<details>
<summary>Your application opens a new database connection per request and the database is struggling. Why, and what is the fix?</summary>

Each PostgreSQL connection is a separate process: connecting costs milliseconds and memory, and many connections compete for the same CPUs and locks. Use a connection pool in the application (and an external pooler such as PgBouncer when there are many application instances), sized small, near the number of cores the database can actually use. See [connection pooling](site:databases/connection-pooling/).
</details>
