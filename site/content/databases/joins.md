Almost every interesting query joins tables, and the join method often decides whether a query takes a millisecond or a minute. PostgreSQL has three, and it picks one per join from its row estimates. Knowing what each one costs tells you what a plan is doing and why it might be the wrong choice.

<div data-widget="join-algos"></div>

## Nested loop

For each row from the outer input, run the inner input once. With no index on the inner side, that means reading all of it for every outer row, so the cost grows as *outer rows × inner rows*. With an index on the inner side's join key, each outer row costs one index lookup, and it becomes the fastest join there is for a small outer side.

```sql setup
create index orders_user_id_idx on orders (user_id);
```

One user and their orders: one outer row, one index lookup on the inner side.

```sql explain-analyze
select u.email, o.id, o.total
from users u
join orders o on o.user_id = u.id
where u.id = 42;
```

Look at `loops` on the inner node: it is how many times the inner side ran. Multiply its rows and time by it to get the real work.

## Hash join

Read the smaller input once and build a hash table on the join key in memory, then read the other input once and look each row up in the table. Each input is read once, which makes it the usual choice for joining many rows to many rows when neither side is sorted.

```sql explain-analyze
select u.country, count(*) as orders
from orders o
join users u on u.id = o.user_id
group by u.country;
```

The `Hash` node shows the table it built: `Buckets`, `Batches` and `Memory Usage`. `Batches: 1` means it fitted in `work_mem`. More than one batch means the table was split and part of it written to temporary files, which is much slower.

## Merge join

Sort both inputs on the join key, then walk them side by side, like merging two sorted lists. It shines when both inputs are already sorted, for example because each one can be read from an index on the join key, and when both are large.

In the sample database a hash join is usually cheaper, so to see a merge join, switch hash joins off for a moment. This is an investigation tool, never something to leave on:

```sql setup
set local enable_hashjoin = off;
```

```sql explain-analyze
select u.country, count(*) as orders
from orders o
join users u on u.id = o.user_id
group by u.country;
```

```sql setup
reset enable_hashjoin;
```

Both inputs come from indexes already in `user_id` order (the index created above, and the users primary key), so there is no `Sort` node: the merge walks the two lists once. Compare its total cost with the hash join version above; the planner chose the hash join because it estimated it to be cheaper.

## How the planner chooses, and how to argue with it

The planner estimates the cost of each method from its row estimates and picks the cheapest. When the estimates are wrong, so is the choice: a nested loop chosen because the planner expected one outer row is a disaster when there are 30,000 (the [stale statistics](site:databases/tuning-exercises/) exercise shows exactly this).

To see what an alternative would have cost, switch a method off for your session and explain again. A handful of users and their orders, which the planner joins with a nested loop over the index:

```sql explain-analyze
select u.email, o.id, o.total
from users u
join orders o on o.user_id = u.id
where u.id between 40 and 45;
```

```sql setup
set local enable_nestloop = off;
```

```sql explain-analyze
select u.email, o.id, o.total
from users u
join orders o on o.user_id = u.id
where u.id between 40 and 45;
```

```sql setup
reset enable_nestloop;
```

Without the nested loop the planner has to read far more of `orders` to join a few users; compare the buffers. In PostgreSQL 18 the `enable_*` settings do not forbid a method outright: plans with fewer disabled steps win first, then the cheapest, and a disabled step that could not be avoided is marked `Disabled: true` in the plan. That happens, for example, when a query fixes a single `u.id = 42`: the planner then knows `o.user_id = 42` as well, no join condition is left, and only a nested loop can do the job.

Use these settings to compare costs and buffers while investigating, never in application code. Then fix the real cause, which is usually an estimate, a missing index, or a function on the join column.

## Quick reference

| | Nested loop | Hash join | Merge join |
|---|---|---|---|
| Best when | Outer side small, index on the inner key | Large inputs, no useful order | Large inputs already sorted on the key |
| Work | outer rows × (one lookup or one scan) | read each side once | sort both (unless sorted), then one pass |
| Memory | little | the hash table (up to `work_mem`, then batches on disk) | the sorts, if any |
| Join conditions | any | equality only | equality (and ordering) only |
| Watch for | large `loops` on the inner side | `Batches` greater than 1 | big `Sort` nodes feeding it |

## In MySQL

*Not run here; from the MySQL reference manual.* MySQL has long used nested loops (with index lookups, plus block nested loop for joins without an index). Since 8.0.18 it can use a hash join for equality joins, and from 8.0.20 the hash join replaced block nested loop. MySQL has no merge join.

## Sources

- PostgreSQL documentation: [*Using EXPLAIN*](https://www.postgresql.org/docs/18/using-explain.html), [*Planner/Optimizer*](https://www.postgresql.org/docs/18/planner-optimizer.html) (internals: planner, join strategies), [*Planner Method Configuration*](https://www.postgresql.org/docs/18/runtime-config-query.html#RUNTIME-CONFIG-QUERY-ENABLE) (`enable_hashjoin`, `enable_mergejoin`, `enable_nestloop`), [*Resource Consumption*](https://www.postgresql.org/docs/18/runtime-config-resource.html) (`work_mem`, `hash_mem_multiplier`).
- MySQL reference manual: [*Nested-Loop Join Algorithms*](https://dev.mysql.com/doc/refman/8.4/en/nested-loop-joins.html), [*Hash Join Optimization*](https://dev.mysql.com/doc/refman/8.4/en/hash-joins.html).
