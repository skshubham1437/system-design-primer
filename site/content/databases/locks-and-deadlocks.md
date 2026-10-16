MVCC means readers and writers rarely wait for each other, but writers still lock what they change, and schema changes lock whole tables. Most "the database is hanging" incidents are not slow queries at all: they are queries waiting for a lock that someone else holds.

## What a statement locks

Every statement takes a lock on each table it touches, in one of eight table-level modes, and holds it until its transaction ends. This runs on the sample database and lists the locks the current transaction holds after an `UPDATE` and a `CREATE INDEX`:

```sql setup
update orders set total = total where id = 5;
create index products_price_idx on products (price);
```

```sql run
select locktype, relation::regclass as relation, mode, granted
from pg_locks
where pid = pg_backend_pid()
  and locktype in ('relation', 'transactionid')
  and (relation is null or relation::regclass::text not like 'pg_%')
order by locktype, relation::regclass::text, mode;
```

The update holds a `RowExclusiveLock` on `orders` (and its indexes), and the transaction holds an `ExclusiveLock` on its own transaction id, which is what other sessions wait on when they want a row it changed. The index build holds a `ShareLock` on `products`: other sessions can still read the table, but **cannot write to it** until the transaction ends. `CREATE INDEX CONCURRENTLY` avoids that, at the cost of a slower build that cannot run inside a transaction.

## Which modes conflict

| Lock mode | Taken by | Blocks |
|---|---|---|
| ACCESS SHARE | `SELECT` | only ACCESS EXCLUSIVE |
| ROW SHARE | `SELECT … FOR UPDATE / FOR SHARE` | EXCLUSIVE, ACCESS EXCLUSIVE |
| ROW EXCLUSIVE | `INSERT`, `UPDATE`, `DELETE`, `MERGE` | SHARE and stronger |
| SHARE UPDATE EXCLUSIVE | `VACUUM`, `ANALYZE`, `CREATE INDEX CONCURRENTLY` | itself and stronger |
| SHARE | `CREATE INDEX` | ROW EXCLUSIVE (all writes) and stronger |
| ACCESS EXCLUSIVE | most `ALTER TABLE`, `DROP`, `TRUNCATE`, `VACUUM FULL` | everything, including `SELECT` |

The middle modes (SHARE ROW EXCLUSIVE, EXCLUSIVE) are rarer and are in the documentation's full table.

Rows are locked separately. An `UPDATE` or `DELETE` locks the rows it changes; `SELECT … FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE` and `FOR KEY SHARE` lock the rows they read. Row locks are stored in the rows themselves rather than in memory, so locking millions of rows is possible, and a transaction waiting for a row lock waits on the transaction id of the one that holds it.

## Waiting for a row

Recorded on a real server with two connections. B changes a different row freely, then waits for the row A is holding:

<div data-widget="tx-trace" data-id="row-lock-wait"></div>

`pg_blocking_pids(pid)` names who is blocking a session, and `pg_stat_activity` shows `wait_event_type = 'Lock'` for anyone waiting. Together they answer "who is blocking whom" on a live system.

## The lock queue: how a quick migration takes a site down

An `ALTER TABLE` that takes a fraction of a second can still stop every query on a table. It needs an ACCESS EXCLUSIVE lock, so it waits behind any open transaction that has merely read the table. Locks are granted in order, so every new query, even a plain `SELECT` that does not conflict with the open transaction, queues behind the migration:

<div data-widget="tx-trace" data-id="lock-queue"></div>

Protect migrations with `SET lock_timeout = '2s'` so they give up and retry instead of stalling everything, and do not leave transactions open longer than they need to be.

## Deadlocks

Two transactions each hold a lock the other wants. Neither can continue, so after `deadlock_timeout` (1 second by default) PostgreSQL checks for a cycle, finds it, and aborts one transaction with error `40P01` so the other can finish:

<div data-widget="tx-trace" data-id="deadlock"></div>

Deadlocks are not bugs in the database; they are the database rescuing two transactions that locked in opposite orders. To make them rare:

1. **Lock in a consistent order.** If every transfer updates the lower account id first, two transfers cannot each hold what the other needs.
2. **Keep transactions short**, so there is less time for overlaps.
3. **Retry** a transaction that fails with a deadlock or serialization error. Some will happen under load however careful you are.

## Patterns that use locks well

**Work queues with SKIP LOCKED.** Several workers can take jobs from one table without waiting for each other, because each skips rows another worker has already locked:

<div data-widget="tx-trace" data-id="skip-locked"></div>

**Advisory locks** lock a number your application chooses rather than a row, for example to make sure only one instance of a nightly job runs:

<div data-widget="tx-trace" data-id="advisory-lock"></div>

## Timeouts worth setting

- `lock_timeout`: give up waiting for a lock after this long. Essential for migrations.
- `statement_timeout`: cancel any statement that runs longer than this.
- `idle_in_transaction_session_timeout`: end sessions that sit in an open transaction doing nothing.

## In MySQL

*Not run here; from the MySQL reference manual.* InnoDB locks rows through its indexes, and at its default repeatable read level also locks the gaps between index records (next-key locks), so a range update can block inserts into that range. It detects deadlocks immediately rather than after a timeout, and rolls back the smaller transaction. `innodb_lock_wait_timeout` (50 seconds by default) limits waits. Many `ALTER TABLE` operations run as online DDL, but still need a brief metadata lock that queues like PostgreSQL's.

## Sources

- PostgreSQL documentation: *Explicit Locking* (Table-Level Locks, Row-Level Locks, Deadlocks, Advisory Locks), *pg_locks*, *pg_stat_activity*, *System Information Functions* (`pg_blocking_pids`), *Client Connection Defaults* (`lock_timeout`, `statement_timeout`), *Lock Management* (`deadlock_timeout`), *The Locking Clause* (`SKIP LOCKED`), *CREATE INDEX* (Building Indexes Concurrently).
- MySQL reference manual: *InnoDB Locking*, *Deadlocks in InnoDB*, *Metadata Locking*.
