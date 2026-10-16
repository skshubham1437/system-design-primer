Two patterns make otherwise reasonable applications slow in exactly the same way: they ask the database to do work it then throws away, or to do the same small job hundreds of times. Both are invisible on a developer's laptop with ten rows and obvious in production with ten million.

## OFFSET pagination gets slower every page

The usual way to show page *n* of a list is `LIMIT 20 OFFSET 20 × n`. OFFSET does not jump: the database produces every skipped row and discards it. Even with an index on the sort column, page 2,500 walks 50,000 index entries first.

```sql setup
create index orders_created_at_idx on orders (created_at);
```

```sql explain-analyze
select id, created_at, total from orders
order by created_at desc
limit 20 offset 50000;
```

## Keyset pagination stays fast

Instead of counting rows, remember where the last page ended and ask for the rows after it. With an index on the sort key this is one descent and twenty entries, whatever the page.

```sql explain-analyze
select id, created_at, total from orders
where created_at < '2023-12-31 14:10:51+00'
order by created_at desc
limit 20;
```

Rules for keyset pagination:

- **The sort key must be unique.** If it is not, add the primary key to it and compare both: `where (created_at, id) < ($1, $2) order by created_at desc, id desc`. PostgreSQL compares such row values element by element, and an index on `(created_at, id)` serves it directly.
- **You get "next" and "previous", not "jump to page 2,500".** For a feed, an inbox or an infinite scroll that is what users do anyway.
- **It is stable.** New rows arriving while someone pages do not shift every later page by one, which OFFSET does.

## The N+1 query problem

Code that loads a list and then, for each item, issues another query makes 1 + N round trips:

```text
users = query("select id, email from users where country = 'NG' limit 50")
for user in users:
    orders = query("select count(*) from orders where user_id = ?", user.id)
```

Each query may be fast, but 50 round trips to the database, each with its own network latency, parsing and planning, add up. The database cannot help: it only ever sees one small query at a time. ORMs produce this pattern easily when they load related objects lazily.

Ask for everything in one query instead, with a join:

```sql explain-analyze
select u.id, u.email, count(o.id) as orders
from users u
left join orders o on o.user_id = u.id
where u.country = 'NG'
group by u.id, u.email
order by u.id
limit 50;
```

Or, when the code already holds the ids, fetch the related rows for all of them in one query with `= any(array)`:

```sql setup
create index orders_user_id_idx on orders (user_id);
```

```sql explain-analyze
select user_id, count(*) from orders
where user_id = any(array[383, 1907, 2401, 5160, 7711])
group by user_id;
```

`Index Searches` (PostgreSQL 18) shows one descent per id, all inside one query and one round trip.

The same thing happens inside SQL when a subquery in the select list runs once per row; the [subquery per row](site:databases/tuning-exercises/) exercise shows it. ORMs have fixes for it under names like eager loading, `includes`, `select_related` / `prefetch_related` or `JOIN FETCH`.

## In MySQL

*Not run here; from the MySQL reference manual.* `LIMIT offset, count` has the same cost as in PostgreSQL: the skipped rows are still read. Keyset pagination and row-value comparisons such as `(created_at, id) < (?, ?)` work in MySQL too, and the N+1 problem is a property of the application, not of the database.

## Sources

- PostgreSQL documentation: *LIMIT and OFFSET* (including the note that skipped rows are still computed), *Row Constructor Comparison*, *Array Comparisons* (`ANY`).
- *Use The Index, Luke*: "Paging Through Results" (the seek method).
- MySQL reference manual: *LIMIT Query Optimization*.
