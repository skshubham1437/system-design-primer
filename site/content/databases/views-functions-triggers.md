PostgreSQL can hold logic as well as data: views name a query, functions and procedures run code inside the server, and triggers run code automatically when rows change. Each is useful, and each moves behaviour somewhere that application developers may not look. Use them where the database is the right place to enforce something, not as a default.

## Views: a named query

A view stores a query, not data. Selecting from it runs the query, and the planner merges it into the outer query as if you had written it out, so a simple view costs nothing.

```sql setup
create view order_summary as
select o.id, o.created_at, o.status, u.email, u.country, o.total
from orders o
join users u on u.id = o.user_id;
```

```sql explain
select * from order_summary where id = 500;
```

The plan reads `orders` and `users` directly through their primary keys; the view has disappeared. Views are good for hiding a join that everyone repeats, giving a stable shape to clients while tables change underneath, and limiting what a role can see (grant access to the view, not the table).

## Functions

A function takes arguments and returns a value or a set of rows. It can be written in SQL or in PL/pgSQL, PostgreSQL's procedural language with variables, loops and error handling.

```sql setup
create function order_value(p_order int) returns numeric
language plpgsql stable as $$
declare
  v numeric;
begin
  select sum(qty * price) into v from order_items where order_id = p_order;
  return coalesce(v, 0);
end;
$$;
```

```sql run
select id, total, order_value(id) as recomputed from orders where id between 1 and 5 order by id;
```

Mark functions `IMMUTABLE`, `STABLE` or `VOLATILE` truthfully: the planner relies on it. Only `IMMUTABLE` functions can be used in an index expression, and a simple SQL-language function can be inlined into the calling query, while a PL/pgSQL function is a black box the planner cannot see into. A function called once per row in a large query is also a classic hidden cost: here, `order_value` runs its own query for every order.

## Procedures

A procedure (`CREATE PROCEDURE`, run with `CALL`) is like a function that returns nothing, with one important difference: it can `COMMIT` and `ROLLBACK` inside its body, when called outside an explicit transaction. That makes it suitable for long maintenance jobs that work in batches and commit as they go.

## Triggers

A trigger runs a function automatically before or after a row is inserted, updated or deleted. A common, sensible use is an audit trail that cannot be forgotten by any code path:

```sql setup
create table price_history (product_id int not null, old_price numeric(10,2), new_price numeric(10,2), changed_at timestamptz not null default now());

create function record_price_change() returns trigger
language plpgsql as $$
begin
  if new.price is distinct from old.price then
    insert into price_history (product_id, old_price, new_price) values (old.id, old.price, new.price);
  end if;
  return new;
end;
$$;

create trigger products_price_audit
after update of price on products
for each row execute function record_price_change();

update products set price = price * 1.10 where category_id = 3;
```

```sql run
select count(*) as changes_recorded, min(new_price - old_price) as smallest_rise, max(new_price - old_price) as largest_rise
from price_history;
```

One `UPDATE` changed every product in the category, and the trigger wrote a history row for each one. The application never had to remember.

## Trade-offs

| | In the database | In the application |
|---|---|---|
| Enforced for every client and code path | yes | only if every path remembers |
| Visible to developers reading the app code | rarely | yes |
| Testing, debugging, code review, deployment | harder, separate tooling | the usual tools |
| Performance | no network round trips; but row-by-row triggers and functions can be slow | extra round trips, but easier to scale out than the database |

Good uses: constraints the data must never violate, audit trails, keeping a denormalised column in step, and batch jobs close to the data. Poor uses: business rules that change often, anything that calls external services, and long chains of triggers firing triggers, which become very hard to reason about.

## In MySQL

*Not run here; from the MySQL reference manual.* MySQL has views, stored functions, stored procedures and triggers with similar roles. Stored routines are written in MySQL's own procedural SQL; there is no choice of language as in PostgreSQL. Triggers are row-level only (`FOR EACH ROW`), with no statement-level triggers.

## Sources

- PostgreSQL documentation: [*Views*](https://www.postgresql.org/docs/18/tutorial-views.html) (tutorial and [*CREATE VIEW*](https://www.postgresql.org/docs/18/sql-createview.html)), [*User-Defined Functions*](https://www.postgresql.org/docs/18/xfunc.html), [*PL/pgSQL*](https://www.postgresql.org/docs/18/plpgsql.html), [*Function Volatility Categories*](https://www.postgresql.org/docs/18/xfunc-volatility.html), [*Inlining of SQL Functions*](https://wiki.postgresql.org/wiki/Inlining_of_SQL_functions) (wiki), [*CREATE PROCEDURE*](https://www.postgresql.org/docs/18/sql-createprocedure.html), [*Transaction Management*](https://www.postgresql.org/docs/18/plpgsql-transactions.html) (in procedures), [*Triggers*](https://www.postgresql.org/docs/18/triggers.html), [*CREATE TRIGGER*](https://www.postgresql.org/docs/18/sql-createtrigger.html).
- MySQL reference manual: [*Stored Objects*](https://dev.mysql.com/doc/refman/8.4/en/stored-objects.html) (stored routines, triggers, views).
