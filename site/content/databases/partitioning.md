Partitioning splits one large table into several smaller tables, its **partitions**, that the database still presents as one. Queries that only need some partitions skip the rest, and old data can be removed by dropping a whole partition instead of deleting millions of rows. It is not a way to spread load across servers; that is [sharding](site:databases/sharding-and-scale/).

<div data-widget="partition-prune"></div>

## Range, list and hash

- **Range** partitions by intervals of a column, usually time: one partition per month or per day. The sample `events` table is partitioned by month on `at`. This is by far the most common kind.
- **List** partitions by explicit values: one partition per country or per tenant tier.
- **Hash** spreads rows evenly by a hash of the key, for when no natural range exists but you still want smaller pieces.

```sql run
select relname as partition, pg_get_expr(relpartbound, oid) as holds
from pg_class
where relispartition and relname like 'events_2024_0%'
order by relname
limit 3;
```

## Partition pruning

Pruning is where most of the benefit comes from. When a condition compares the partition key with values, the planner checks each partition's bounds and leaves out the ones that cannot match:

```sql explain-analyze
select count(*) from events where at >= '2024-11-01' and at < '2024-12-01';
```

The plan reads one partition. The same question asked through a function of the key cannot be pruned, so every partition is read:

```sql explain-analyze
select count(*) from events where date_trunc('month', at) = '2024-11-01';
```

The [one month of events](site:databases/tuning-exercises/) exercise asks you to fix exactly this. Pruning also happens while a query runs, for values that are only known then, such as parameters of a prepared statement; the plan then reports how many partitions it skipped.

## Hash partitioning

```sql setup
create table sessions (id bigint not null, user_id int not null, started_at timestamptz not null) partition by hash (user_id);
create table sessions_0 partition of sessions for values with (modulus 4, remainder 0);
create table sessions_1 partition of sessions for values with (modulus 4, remainder 1);
create table sessions_2 partition of sessions for values with (modulus 4, remainder 2);
create table sessions_3 partition of sessions for values with (modulus 4, remainder 3);
insert into sessions select g, 1 + abs(hashint4(g)) % 20000, timestamptz '2024-06-01' from generate_series(1, 40000) g;
```

```sql run
select tableoid::regclass as partition, count(*) as rows from sessions group by 1 order by 1;
```

```sql explain
select * from sessions where user_id = 42;
```

The rows are spread almost evenly, and a query for one user reads one partition. A query for a range of users gets no pruning at all: hash partitions have no order.

## Removing old data

With time-range partitions, deleting a month is a metadata change instead of a huge `DELETE` that writes WAL for every row and leaves the table full of dead rows:

```sql setup
alter table events detach partition events_2024_01;
```

```sql run
select count(*) as events_still_visible from events;
```

`DETACH PARTITION` turns January into an ordinary table (archive it, or `DROP` it); `DETACH … CONCURRENTLY` does it without blocking queries for long. New partitions for coming months are typically created ahead of time by a scheduled job.

## The limits

- **Unique constraints and primary keys must include the partition key**, because each partition enforces uniqueness only within itself. There are no global indexes across partitions.
- **Too many partitions slows planning.** Hundreds are fine; tens of thousands are not. Partition by month or day, not by hour, unless you have measured.
- **Queries that do not filter on the partition key read every partition**, and can be slower than on one big table.
- **It is still one server.** Partitioning makes a big table manageable; it does not add CPU, memory or disks.

## In MySQL

*Not run here; from the MySQL reference manual.* MySQL supports range, list, hash and key partitioning, with pruning on the partitioning key. As in PostgreSQL, every unique key must include all partitioning columns, and dropping a partition is the fast way to remove old data.

## Sources

- PostgreSQL documentation: *Table Partitioning* (declarative partitioning, partition pruning, partition maintenance, best practices), *CREATE TABLE* (`PARTITION BY`, `FOR VALUES WITH`), *ALTER TABLE* (`DETACH PARTITION`).
- MySQL reference manual: *Partitioning*, *Partition Pruning*, *Partitioning Keys, Primary Keys, and Unique Keys*.
