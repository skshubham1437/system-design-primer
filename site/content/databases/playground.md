A real PostgreSQL database runs in this page, inside your browser. It holds a small online shop: users, products, orders and the items in each order. Write any SQL you like: read, change, add an index, drop a table. Nothing leaves your machine, and **Reset** puts everything back the way it was.

<div data-widget="sql-playground"></div>

## What is in the sample database

The same data is loaded every time, so the plans and numbers you see match the ones on the other pages.

```sql run
select 'users' as table_name, count(*) as rows from users
union all select 'products', count(*) from products
union all select 'categories', count(*) from categories
union all select 'orders', count(*) from orders
union all select 'order_items', count(*) from order_items
union all select 'events', count(*) from events;
```

| Table | Columns | Worth knowing |
|---|---|---|
| `users` | `id`, `email`, `name`, `country`, `status`, `created_at` | `country` is skewed: about 40% `IN`, only about 2% `NG`. `status` is mostly `active`; 3% are `banned`. `email` is unique. |
| `products` | `id`, `category_id`, `name`, `price` | 40 categories. |
| `orders` | `id`, `user_id`, `status`, `created_at`, `total` | Ids rise with `created_at`, about one order every ten minutes over two years. A few users order a lot: user 1 has hundreds of orders, the typical user has four. About 4% of orders are `pending`. |
| `order_items` | `order_id`, `product_id`, `qty`, `price` | One to five products per order. The key is `(order_id, product_id)`. |
| `events` | `id`, `user_id`, `kind`, `at` | Partitioned by month across 2024. |

Every table has a primary key, and the foreign keys are declared, but **there are no other indexes**. Deciding which ones to add is what most of this section is about.

The skew is deliberate. Real data is rarely even, and a query plan that is right for a rare value can be wrong for a common one.

## Things to try

1. Run **One user's orders**, then press **Explain analyze**. The database reads every one of the 100,000 orders to find a handful. Look for `Seq Scan` and `Rows Removed by Filter`.
2. Run **Add an index**, go back to the same query and explain it again. The plan changes, and the work drops by orders of magnitude.
3. Change `user_id = 42` to `user_id = 1`. User 1 has hundreds of orders. Does the plan change again?
4. Press **Reset the database** to throw your changes away.

## About the engine

The database is [PGlite](https://pglite.dev), PostgreSQL compiled to WebAssembly. It is the real PostgreSQL planner and executor, so plans read exactly as they would on a server. Two differences matter: it has a single connection, so two sessions cannot block each other here (the pages on locks use recordings from a real server instead), and it runs in your browser's memory, so absolute timings are slower than a tuned server. Compare plans and row counts, not milliseconds.
