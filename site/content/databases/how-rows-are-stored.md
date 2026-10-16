Before indexes and query plans make sense, it helps to know what a table actually is on disk. In PostgreSQL the answer is simple: a table is a file of fixed-size pages, and rows are written into those pages roughly in the order they arrive. Almost everything else in this section follows from that.

## A table is a file of pages

Every table is stored as a sequence of **pages** (also called blocks), each **8 kB**. A page holds a small header, an array of pointers to the rows on it, and the rows themselves. The database always reads and writes whole pages, never single rows, so "how many pages does this touch?" is the most useful question to ask about any query.

```sql run
select relname as table_name,
       relpages as pages,
       reltuples::bigint as estimated_rows,
       pg_size_pretty(pg_relation_size(oid)) as size
from pg_class
where relname in ('orders', 'order_items', 'users', 'products')
order by relpages desc;
```

The 100,000 orders fit in a little over 800 pages, so roughly 120 rows per page. A query that has to look at every order reads all of those pages. One that knows where to look might read three or four.

## Every row has an address

Each row's physical location is its `ctid`: the page number and the row's position on that page. Indexes point at rows through these addresses.

```sql run
select ctid, id, user_id, status, total
from orders
order by id
limit 5;
```

`(0,1)` means page 0, item 1. Because orders were inserted in id order, consecutive ids sit next to each other on the same pages. That physical order matters later: reading rows that are next to each other on disk is much cheaper than reading rows scattered across the table.

## An update writes a new version of the row

PostgreSQL does not overwrite a row in place. An `UPDATE` writes a **new version** of the row and marks the old one as replaced. This is how **MVCC** (multi-version concurrency control) works: a transaction that started earlier can still see the old version while a later one sees the new one, and neither has to wait for the other.

Two hidden columns record this. `xmin` is the transaction that created this version; `xmax` is the transaction that replaced or deleted it (0 while the row is current).

```sql run
select ctid, xmin, xmax, status from orders where id = 1;
```

```sql setup
update orders set status = 'shipped' where id = 1;
```

```sql run
select ctid, xmin, xmax, status from orders where id = 1;
```

After the update the row has a new `ctid`: it is physically a different row, written by a newer transaction. Page 0 had no free space left, so the new version went to the end of the table. The old version is still in the table, invisible to new queries, until it is cleaned up. (These examples run inside a transaction that is rolled back, so the sample data is unchanged afterwards.)

## Dead rows and VACUUM

Old versions that no transaction can see any more are **dead rows**. They still take up space in their pages, and scans still have to step over them. `VACUUM` finds dead rows and marks their space as free for reuse. PostgreSQL runs it automatically (autovacuum) once enough of a table has changed.

When updates and deletes outpace vacuuming, a table fills up with dead rows. This is called **bloat**: the table and its indexes grow, and every scan reads more pages than the live data needs. `VACUUM` makes the space reusable but does not usually shrink the file; `VACUUM FULL` rewrites the table compactly, but locks it while it does.

There is one important shortcut. If an update changes no indexed column and the new version fits on the same page, PostgreSQL makes a **heap-only tuple (HOT)** update: the indexes are not touched at all, because they can still find the row through the old version's pointer. This is one reason not to index columns that change often.

## The write-ahead log

Before a changed page is written to the table's file, the change is first recorded in the **write-ahead log (WAL)**, an append-only file. A commit only has to wait for its WAL records to reach disk, which is fast because the log is written sequentially. After a crash, the database replays the log to restore every committed change. The same log stream is what [replicas](site:labs/replication/) receive to stay in step with the primary.

## B-trees and LSM trees

PostgreSQL keeps tables as heaps of pages and indexes as B-trees, updated in place (plus the WAL). Many newer stores, such as RocksDB, Cassandra and other [wide-column and key-value stores](#nosql), use a **log-structured merge tree (LSM tree)** instead.

| | B-tree storage (PostgreSQL, MySQL) | LSM tree (RocksDB, Cassandra) |
|---|---|---|
| A write | Finds the right page and changes it | Appends to an in-memory table, later flushed as a sorted file |
| A read | Follows one path down the tree | May check several sorted files (helped by bloom filters) |
| Background work | Vacuum, page splits | Compaction: merging sorted files |
| Strong at | Reads, and a mix of reads and updates | Very high write rates |

Neither is better in general. LSM trees trade read work and compaction for cheap writes; B-trees trade some write work for predictable reads.

## In MySQL

*Not run here; from the MySQL reference manual.* InnoDB stores each table as a B-tree **clustered on the primary key**: the rows live inside the primary key index, in key order. Secondary indexes store the primary key value instead of a physical address, so a lookup through a secondary index then searches the primary key index. Old row versions for MVCC are kept in a separate undo log rather than in the table, and a background purge removes them, instead of `VACUUM`.

## Sources

- PostgreSQL documentation: *Database Page Layout*, *Introduction to MVCC* (Concurrency Control), *Routine Vacuuming*, *Heap-Only Tuples (HOT)*, *Write-Ahead Logging (WAL)*, *System Columns*.
- MySQL reference manual: *Clustered and Secondary Indexes*, *InnoDB Multi-Versioning*.
