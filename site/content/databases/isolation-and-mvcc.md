Isolation decides what a transaction can see of other transactions that run at the same time. Stronger isolation removes more surprises and costs more retries; weaker isolation is faster and leaves more for the application to get right. PostgreSQL implements all of it with **MVCC**: instead of making readers wait for writers, every transaction reads from a snapshot.

## MVCC: snapshots instead of read locks

As the [storage page](site:databases/how-rows-are-stored/) shows, an update writes a new version of a row and leaves the old one in place. Each version records the transaction that created it (`xmin`) and the one that replaced it (`xmax`). A snapshot is simply a note of which transactions had committed when it was taken; a query sees exactly the row versions those transactions produced.

The consequences are what make PostgreSQL pleasant under load:

- **Readers never block writers, and writers never block readers.** A long report does not stop updates, and updates do not stop the report.
- **Writers do block writers** on the same row: the second one waits for the first to commit or roll back (see [locks](site:databases/locks-and-deadlocks/)).
- Old versions pile up until no snapshot can need them, and then `VACUUM` removes them. A transaction left open for hours keeps every newer dead version alive.

## The isolation levels

| Level in PostgreSQL | Snapshot taken | Dirty read | Non-repeatable read | Phantom read | Lost update / write skew |
|---|---|---|---|---|---|
| Read uncommitted | (behaves as read committed) | not possible | possible | possible | possible |
| **Read committed** (default) | at the start of each statement | not possible | possible | possible | possible |
| Repeatable read | at the first query of the transaction | not possible | not possible | not possible | write skew possible; a conflicting update is refused |
| Serializable | as repeatable read, plus conflict tracking | not possible | not possible | not possible | not possible: one transaction is aborted |

The SQL standard allows phantom reads at repeatable read; PostgreSQL's snapshot prevents them anyway. Higher levels report problems as errors with SQLSTATE `40001` (serialization failure). **Code that uses them must retry the whole transaction** when it sees one.

## Read committed: each statement sees the latest commits

Recorded on a real server. Session B runs the same query twice in one transaction and gets two different answers, because A committed in between:

<div data-widget="tx-trace" data-id="read-committed"></div>

That is fine for most work, as long as you do not read a value, decide in the application, and write back a result based on it. That is the [lost update](site:databases/transactions/).

## Repeatable read: one snapshot for the whole transaction

Every query in the transaction sees the database as it was at its first query. Reports that read several tables get a consistent picture. If the transaction tries to update a row that someone else changed after its snapshot, PostgreSQL refuses rather than overwrite it:

<div data-widget="tx-trace" data-id="repeatable-read"></div>

## Serializable: as if one at a time

Some anomalies involve no conflicting write at all. Two doctors are on call; the rule is that at least one must stay. Each checks that two are on call and takes themselves off, each updating a *different* row. At repeatable read both commit and nobody is on call. That is **write skew**. Serializable isolation tracks what each transaction read and wrote, and aborts one of them when the combination could not have happened one after the other:

<div data-widget="tx-trace" data-id="write-skew"></div>

Serializable is the easiest level to reason about: if every transaction is correct on its own, they are correct together. The price is more aborted transactions under contention, and a little tracking overhead. Keep serializable transactions short, and declare read-only ones `READ ONLY`.

## Choosing

- **Read committed** for most OLTP work, with the database doing read-modify-write in one statement, or `SELECT … FOR UPDATE` where it cannot.
- **Repeatable read** for reports and exports that must see one consistent state across many queries.
- **Serializable** when correctness depends on rules that span rows or tables (balances, bookings, quotas), and you would rather retry than reason about every interleaving.

## In MySQL

*Not run here; from the MySQL reference manual.* InnoDB's default is **repeatable read**, not read committed. Plain `SELECT`s read from a snapshot, but locking reads and `UPDATE`s see the latest committed version and use next-key (gap) locks to prevent phantoms, so the behaviour differs from PostgreSQL's in detail. InnoDB's serializable level turns plain `SELECT`s into locking reads instead of using PostgreSQL's conflict tracking.

## Sources

- PostgreSQL documentation: [*Concurrency Control*](https://www.postgresql.org/docs/18/mvcc.html) (Introduction, Transaction Isolation, Read Committed, Repeatable Read, Serializable Isolation Level), [*SET TRANSACTION*](https://www.postgresql.org/docs/18/sql-set-transaction.html), [*PostgreSQL Error Codes*](https://www.postgresql.org/docs/18/errcodes-appendix.html) (40001).
- Ports and Grittner, [*Serializable Snapshot Isolation in PostgreSQL*](https://arxiv.org/abs/1208.4179) (VLDB 2012).
- MySQL reference manual: [*Transaction Isolation Levels*](https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html), [*Consistent Nonlocking Reads*](https://dev.mysql.com/doc/refman/8.4/en/innodb-consistent-read.html), [*Phantom Rows*](https://dev.mysql.com/doc/refman/8.4/en/innodb-next-key-locking.html).
