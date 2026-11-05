A window function computes a value for each row from a set of related rows (its window) without collapsing them into one, as `GROUP BY` would. Rankings, running totals, "previous value" comparisons and "top N per group" all become one readable query instead of a self-join or application code.

## Numbering rows within a group

`over (partition by … order by …)` defines the window: rows with the same `user_id`, in order of `created_at`. Each user's first, second and third order:

```sql run
select user_id, id as order_id, created_at::date as day, total,
       row_number() over (partition by user_id order by created_at) as nth_order
from orders
where user_id in (2, 3)
order by user_id, nth_order
limit 8;
```

`row_number()` numbers rows 1, 2, 3; `rank()` gives ties the same number and skips the next ones; `dense_rank()` gives ties the same number without gaps.

## Top N per group

The three best-selling products in each of the first two categories. The window ranks products inside each category; the outer query keeps the top three:

```sql run
select category_id, product_id, revenue, rnk
from (
  select p.category_id, oi.product_id, sum(oi.qty * oi.price) as revenue,
         rank() over (partition by p.category_id order by sum(oi.qty * oi.price) desc) as rnk
  from order_items oi
  join products p on p.id = oi.product_id
  where p.category_id <= 2
  group by p.category_id, oi.product_id
) ranked
where rnk <= 3
order by category_id, rnk;
```

A window function runs after `WHERE` and `GROUP BY`, so it cannot be filtered in the same query level; the subquery is the usual pattern.

## Comparing with the previous row

`lag()` and `lead()` read a value from an earlier or later row of the window. Monthly revenue and the change from the month before:

```sql run
select to_char(month, 'YYYY-MM') as month, revenue,
       revenue - lag(revenue) over (order by month) as change
from (
  select date_trunc('month', created_at) as month, sum(total) as revenue
  from orders
  group by 1
) m
order by month
limit 6;
```

## Running totals and moving averages

Add `order by` to an aggregate's window and it becomes cumulative; add a frame (`rows between …`) and it becomes a moving window:

```sql run
select day, orders,
       sum(orders) over (order by day) as running_total,
       round(avg(orders) over (order by day rows between 6 preceding and current row), 1) as seven_day_avg
from (
  select created_at::date as day, count(*) as orders
  from orders
  where created_at >= '2024-06-01' and created_at < '2024-06-11'
  group by 1
) d
order by day;
```

## What it costs

A window function needs its rows sorted by the partition and order keys, so a plan usually shows a `WindowAgg` above a `Sort`. An index matching `(partition columns, order columns)` can remove the sort, exactly as for `ORDER BY`:

```sql explain
select user_id, id, row_number() over (partition by user_id order by created_at)
from orders;
```

## Materialized views: compute once, read many times

When the same expensive aggregate is read constantly, store its result. A materialized view is a query whose rows are saved like a table, and refreshed when you ask:

```sql setup
create materialized view monthly_revenue as
select date_trunc('month', created_at) as month, sum(total) as revenue, count(*) as orders
from orders
group by 1;
create unique index on monthly_revenue (month);
```

```sql explain-analyze
select * from monthly_revenue where month = '2024-06-01';
```

Reading it touches a few pages instead of the whole orders table. The cost is staleness: the rows only change on `REFRESH MATERIALIZED VIEW`. A plain refresh blocks reads of the view while it runs; `REFRESH MATERIALIZED VIEW CONCURRENTLY` does not, but needs a unique index on the view, like the one above. This is the database version of [caching](#cache): fast reads in exchange for data that can be out of date.

## In MySQL

*Not run here; from the MySQL reference manual.* MySQL 8.0 supports the same window functions (`row_number`, `rank`, `dense_rank`, `lag`, `lead`, frames). It has no materialized views; the usual substitute is a summary table kept up to date by the application, an event or triggers.

## Sources

- PostgreSQL documentation: [*Window Functions*](https://www.postgresql.org/docs/18/tutorial-window.html) (tutorial), [*Window Function Calls*](https://www.postgresql.org/docs/18/sql-expressions.html#SYNTAX-WINDOW-FUNCTIONS) (syntax and frames), [*Window Functions*](https://www.postgresql.org/docs/18/functions-window.html) (function list), [*Materialized Views*](https://www.postgresql.org/docs/18/rules-materializedviews.html), [*REFRESH MATERIALIZED VIEW*](https://www.postgresql.org/docs/18/sql-refreshmaterializedview.html).
- MySQL reference manual: [*Window Functions*](https://dev.mysql.com/doc/refman/8.4/en/window-functions.html).
