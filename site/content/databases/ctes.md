A common table expression (CTE) is a named subquery written up front with `WITH`. It makes long queries readable as a sequence of steps, it is the only way to write recursive queries in SQL, and it can chain data changes together. Since PostgreSQL 12, it usually costs nothing extra.

## Readable steps

Big spenders in 2024: first total each user's orders, then join the totals to users.

```sql run
with spend as (
  select user_id, sum(total) as spent, count(*) as orders
  from orders
  where created_at >= '2024-01-01'
  group by user_id
)
select u.email, s.orders, s.spent
from spend s
join users u on u.id = s.user_id
order by s.spent desc
limit 5;
```

## Inlined or materialized

A CTE that is referenced once and has no side effects is **inlined**: the planner treats it as if you had written a subquery, so conditions from the outer query can be pushed into it and indexes can be used.

```sql setup
create index orders_created_at_idx on orders (created_at);
```

```sql explain
with recent as (
  select * from orders where created_at >= '2024-12-01'
)
select count(*) from recent where status = 'pending';
```

Mark it `MATERIALIZED` and it is computed once, on its own, into a temporary result; the outer query reads that result with a `CTE Scan`, and its conditions can no longer reach inside:

```sql explain
with recent as materialized (
  select * from orders where created_at >= '2024-12-01'
)
select count(*) from recent where status = 'pending';
```

Materializing is the right call when a CTE is expensive and referenced several times, or when you deliberately want to stop the planner from merging it into the outer query. Before PostgreSQL 12 every CTE was materialized, which is why older advice warns that CTEs are an "optimisation fence".

## Recursive queries

A recursive CTE has a starting query, `UNION ALL`, and a query that refers to the CTE itself. It repeats the second part until it produces no new rows, which is how trees and graphs are walked in SQL. A small organisation chart:

```sql setup
create table staff (id int primary key, name text not null, manager_id int references staff);
insert into staff values (1, 'Mira', null), (2, 'Theo', 1), (3, 'Lena', 1), (4, 'Omar', 2), (5, 'Ines', 2), (6, 'Kai', 3), (7, 'Zoe', 4);
```

```sql run
with recursive chain as (
  select id, name, 0 as depth, name::text as path
  from staff
  where manager_id is null
  union all
  select s.id, s.name, c.depth + 1, c.path || ' > ' || s.name
  from staff s
  join chain c on s.manager_id = c.id
)
select depth, path from chain order by path;
```

Two safety rules. Make sure the recursion stops: a cycle in the data (someone managing their own manager) would loop forever, which the `CYCLE` clause (PostgreSQL 14 and later) or a depth limit prevents. And index the column the recursive step joins on (here `manager_id`), because the recursive part runs once per level.

## Data changes in a CTE

A CTE can contain `INSERT`, `UPDATE` or `DELETE` with `RETURNING`, and the rest of the query can use the rows it returns. Moving the first week of events to an archive in one statement:

```sql setup
create table events_archive (like events);
```

```sql run
with moved as (
  delete from events where at < '2024-01-08' returning *
), archived as (
  insert into events_archive select * from moved returning 1
)
select count(*) as moved_to_archive from archived;
```

The whole statement runs as one unit: either every row is moved, or nothing changes.

## In MySQL

*Not run here; from the MySQL reference manual.* MySQL 8.0 added CTEs, including recursive ones, and the optimizer can merge a CTE into the outer query or materialize it. CTEs in MySQL can only contain `SELECT`; data-changing CTEs as above are a PostgreSQL feature.

## Sources

- PostgreSQL documentation: [*WITH Queries (Common Table Expressions)*](https://www.postgresql.org/docs/18/queries-with.html), including [*Recursive Queries*](https://www.postgresql.org/docs/18/queries-with.html#QUERIES-WITH-RECURSIVE), [*CTE Materialization*](https://www.postgresql.org/docs/18/queries-with.html#QUERIES-WITH-CTE-MATERIALIZATION), [*Search Order and Cycle Detection*](https://www.postgresql.org/docs/18/queries-with.html#QUERIES-WITH-SEARCH) and [*Data-Modifying Statements in WITH*](https://www.postgresql.org/docs/18/queries-with.html#QUERIES-WITH-MODIFYING); [PostgreSQL 12 release notes](https://www.postgresql.org/docs/release/12.0/) (CTE inlining).
- MySQL reference manual: [*WITH (Common Table Expressions)*](https://dev.mysql.com/doc/refman/8.4/en/with.html).
