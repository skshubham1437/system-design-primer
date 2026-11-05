A transaction groups statements so that they succeed or fail together. It is the promise that makes a bank transfer, an order with its line items, or a sign-up with its profile safe, even when two people do the same thing at the same moment or the server crashes halfway.

## ACID in one paragraph each

- **Atomicity.** Either every statement in the transaction takes effect, or none does. A failure halfway, an error, or a `ROLLBACK` undoes the lot.
- **Consistency.** The database moves from one valid state to another: constraints such as primary keys, foreign keys and `CHECK`s hold at the end of every transaction.
- **Isolation.** Transactions running at the same time do not see each other's unfinished work, and, depending on the [isolation level](site:databases/isolation-and-mvcc/), are protected from some or all of the anomalies that concurrency causes.
- **Durability.** Once `COMMIT` returns, the change survives a crash, because its [write-ahead log](site:databases/how-rows-are-stored/) records reached disk first.

## Writing one

```text
BEGIN;
UPDATE accounts SET balance = balance - 50 WHERE id = 1;
UPDATE accounts SET balance = balance + 50 WHERE id = 2;
COMMIT;
```

Without `BEGIN`, every statement is its own transaction (autocommit). In PostgreSQL, once a statement inside a transaction fails, the transaction is aborted: every later statement is refused until you `ROLLBACK`. That is deliberate, so that half of a unit of work can never be committed by accident.

## Savepoints: undo part of a transaction

A savepoint marks a point you can roll back to without abandoning the whole transaction. This runs on the sample database:

```sql setup
savepoint before_cancel;
update orders set status = 'cancelled' where id = 10;
```

```sql run
select id, status from orders where id = 10;
```

```sql setup
rollback to savepoint before_cancel;
```

```sql run
select id, status from orders where id = 10;
```

The order is back to its original status, and the transaction around it is still open. Drivers and ORMs use savepoints to implement nested transactions.

## When two transactions touch the same row

Transactions protect each statement's integrity, but not the logic your application runs between statements. The classic failure is the **lost update**: two sessions read the same balance, each adds to it in application code, and each writes back its own total. Both commit, no error is raised, and one deposit disappears. Recorded on a real server, with two connections:

<div data-widget="tx-trace" data-id="lost-update"></div>

There are three standard fixes:

1. **Let the database do the arithmetic**: `update accounts set balance = balance + 30 where id = 1`. The second update waits for the first and adds to its result.
2. **Lock the row when you read it** with `SELECT … FOR UPDATE`, so the second reader waits until the first has finished:

<div data-widget="tx-trace" data-id="select-for-update"></div>

3. **Detect the conflict** with a higher [isolation level](site:databases/isolation-and-mvcc/), or with a version column (`update … set version = version + 1 where id = 1 and version = 7`, and treat zero updated rows as a conflict), and retry.

## Keep transactions short

An open transaction holds its locks and keeps old row versions alive for [VACUUM](site:databases/how-rows-are-stored/) to wait on. Never wait for a user, a network call or a file upload inside one. A connection left `idle in transaction` is a common cause of blocked queries and table bloat; `idle_in_transaction_session_timeout` makes PostgreSQL end such sessions automatically.

## In MySQL

*Not run here; from the MySQL reference manual.* InnoDB transactions are ACID as well, with `START TRANSACTION`, `COMMIT`, `ROLLBACK` and savepoints. One difference matters in practice: in MySQL a failed statement does not abort the surrounding transaction, so the application must decide whether to roll back. Statements such as `ALTER TABLE` cause an implicit commit in MySQL; in PostgreSQL most schema changes are transactional and can be rolled back.

## Sources

- PostgreSQL documentation: [*Transactions*](https://www.postgresql.org/docs/18/tutorial-transactions.html) (tutorial), [*BEGIN*](https://www.postgresql.org/docs/18/sql-begin.html), [*COMMIT*](https://www.postgresql.org/docs/18/sql-commit.html), [*SAVEPOINT*](https://www.postgresql.org/docs/18/sql-savepoint.html), [*ROLLBACK TO SAVEPOINT*](https://www.postgresql.org/docs/18/sql-rollback-to.html), [*SELECT … FOR UPDATE*](https://www.postgresql.org/docs/18/sql-select.html#SQL-FOR-UPDATE-SHARE) (The Locking Clause), [*Client Connection Defaults*](https://www.postgresql.org/docs/18/runtime-config-client.html) (`idle_in_transaction_session_timeout`).
- MySQL reference manual: [*START TRANSACTION, COMMIT, and ROLLBACK*](https://dev.mysql.com/doc/refman/8.4/en/commit.html), [*Statements That Cause an Implicit Commit*](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html).
