### The SQL tuning advice above is about MySQL

The "Tighten up the schema" list was written for MySQL, and several points do not carry over to PostgreSQL. The PostgreSQL behaviour below was checked on PostgreSQL 18.6.

| The advice above | In PostgreSQL |
|---|---|
| Use `CHAR` instead of `VARCHAR` for fixed-length fields | No speed advantage. `char(n)` pads values with spaces, so it takes more room: `'abc'` stored as `char(10)` took 14 bytes, against 7 for `varchar(10)` or `text`. The PostgreSQL manual says `char(n)` is usually the slowest of the three. Use `text`, or `varchar(n)` when you want a length limit. |
| Use `INT` for numbers up to 2^32, about 4 billion | PostgreSQL's `integer` is signed, so it stops at 2,147,483,647 (about 2.1 billion); one more fails with `integer out of range`. The 4 billion figure is MySQL's `INT UNSIGNED`, and PostgreSQL has no unsigned types. Use `bigint` for ids that can keep growing, such as orders or events. |
| `VARCHAR(255)` makes the best use of a byte | A MySQL storage detail: its length prefix takes one byte up to 255 bytes. PostgreSQL stores `varchar(n)` and `text` the same way, and 255 has no special meaning. |
| `TEXT` allows boolean searches | That is MySQL's `FULLTEXT` search. PostgreSQL's equivalent is full-text search with `tsvector` and `tsquery`, usually with a GIN index. |
| Profile with the slow query log | PostgreSQL logs slow statements with `log_min_duration_statement`, and the `pg_stat_statements` extension keeps totals per query. |

The rest holds in both: `DECIMAL` (`numeric` in PostgreSQL) for money, files kept outside the database with only their location stored, and `NOT NULL` wherever a value is required.

### Words for the same thing

This page says **master** and **slave**. Most current documentation says **primary** and **replica** (PostgreSQL also says *standby*), and some systems say **leader** and **follower**. They mean the same roles. The [Databases](site:databases/) section and the [replication lab](site:labs/replication/) use primary and replica.

### Going deeper

The [Databases](site:databases/) section runs a real PostgreSQL in your browser. It covers how rows and [indexes](site:databases/btree-indexes/) are stored, [reading query plans](site:databases/reading-plans/), [transactions and isolation](site:databases/isolation-and-mvcc/), and [replicas and sharding](site:databases/sharding-and-scale/), and it has [exercises](site:databases/tuning-exercises/) where you make slow queries fast.
