Opening a database connection is expensive, and holding many open is expensive too. A connection pool keeps a small set of connections open and lends them to requests as they need one. Almost every production application needs one, and getting its size wrong is a common way to make a healthy database look overloaded.

## Why connections are expensive

- **Each PostgreSQL connection is a separate server process**, started when the client connects. Starting one involves the network, authentication (often TLS), and process start-up: milliseconds, which is far longer than many queries take.
- **Each process uses memory**, and each sort or hash in it can use up to `work_mem` on top.
- **`max_connections` is limited** (100 by default) because thousands of processes competing for the same CPUs and locks slow each other down. More connections than cores doing work at once does not make work finish sooner; it makes every query wait in more queues.

## What a pool does

An application-side pool (HikariCP in Java, `pgxpool` in Go, `pg.Pool` in Node.js, SQLAlchemy's pool in Python, and so on) opens connections once and reuses them. A request borrows a connection, runs its queries, and returns it. When every connection is busy, the next request waits in the pool's queue, which is exactly where you want waiting to happen: in your application, visible and bounded, not inside the database.

An **external pooler** such as PgBouncer sits between many application instances and the database, so that hundreds of application processes can share a few dozen server connections. It has three modes:

| Mode | A server connection is held for | Works with | Breaks |
|---|---|---|---|
| Session | the whole client connection | everything | little, but also saves little |
| Transaction | one transaction | most web apps | anything that relies on session state across transactions: `SET` without `LOCAL`, session advisory locks, `LISTEN`, temporary tables |
| Statement | one statement | autocommit-only workloads | multi-statement transactions |

Prepared statements used to be the classic casualty of transaction mode; PgBouncer has supported protocol-level prepared statements in transaction mode since version 1.21, but check your driver and configuration rather than assume.

## How big should the pool be?

Smaller than most people expect. The database can only do as much work at once as it has CPU cores and disk bandwidth; connections beyond that mostly queue inside the server. Two consequences:

- **Total connections across every application instance must stay under `max_connections`**, with room for maintenance and monitoring. Ten instances with a pool of 50 each is 500 connections.
- **Start small and measure.** A widely quoted starting point, from the HikariCP project, is about *(CPU cores × 2) + number of disks* for the whole database, then adjust from measurements. When requests wait for the pool, first check whether queries can get faster or transactions shorter; growing the pool only moves the queue into the database.

The [load curve lab](site:labs/load-curve/) shows why: past a certain utilisation, adding more work in parallel makes every request slower.

## Things that hold a connection longer than necessary

- Doing slow non-database work (calling another service, rendering, uploading) while holding a connection or, worse, an open transaction.
- Transactions left open by a missing `COMMIT` or `ROLLBACK` in an error path: the connection goes back to the pool `idle in transaction`, still holding locks.
- One query per item in a loop ([N+1](site:databases/pagination-and-n-plus-one/)), which holds the connection for many round trips.

## In MySQL

*Not run here; from the MySQL reference manual.* MySQL serves each connection with a thread rather than a process, so connections are cheaper than in PostgreSQL, but the same limits on useful concurrency apply. `max_connections` defaults to 151. Application-side pools are used the same way, and ProxySQL is a common external pooler and router.

## Sources

- PostgreSQL documentation: [*Connections and Authentication*](https://www.postgresql.org/docs/18/runtime-config-connection.html) (`max_connections`), [*Resource Consumption*](https://www.postgresql.org/docs/18/runtime-config-resource.html) (`work_mem`), [*Architectural Fundamentals*](https://www.postgresql.org/docs/18/tutorial-arch.html) (one process per connection).
- PgBouncer documentation: [*Pooling modes*](https://www.pgbouncer.org/features.html), [*max_prepared_statements*](https://www.pgbouncer.org/config.html#max_prepared_statements).
- HikariCP wiki: [*About Pool Sizing*](https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing).
- MySQL reference manual: [*Server System Variables*](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html) (`max_connections`).
