-- The sample database used by every page, playground and exercise in the Databases section.
-- It runs in the browser (PGlite) and at build time (Node), so it must be fast and must give the same
-- rows every time: values come from hashint4() of the row number, never from random().
--
-- Shape, chosen so that query plans have something to react to:
--   users        20,000   country and status are skewed (a few values are rare)
--   categories       40
--   products      2,000
--   orders      100,000   ids rise with created_at; a few users place many orders; 'pending' is rare (about 4%)
--   order_items ~300,000  1 to 5 items per order
--   events       60,000   partitioned by month across 2024
--
-- Rows are loaded first and keys added afterwards, which is several times faster than inserting into indexed tables.
-- There are deliberately no secondary indexes: adding the right one is what many exercises ask for.

-- Every machine sees the same timestamps and partition boundaries.
set timezone = 'UTC';

create table categories (id int, name text not null);
create table users (id int, email text not null, name text not null, country text not null, status text not null, created_at timestamptz not null);
create table products (id int, category_id int not null, name text not null, price numeric(10,2) not null);
create table order_items (order_id int not null, product_id int not null, qty int not null, price numeric(10,2) not null);
create table orders (id int, user_id int not null, status text not null, created_at timestamptz not null, total numeric(12,2) not null);

insert into categories
select g, (array['Books','Music','Games','Garden','Kitchen','Toys','Sports','Office','Beauty','Pets'])[1 + (g - 1) % 10] || ' ' || (1 + (g - 1) / 10)
from generate_series(1, 40) g;

-- country: about 40% IN, 25% US, then a long tail; status: 77% active, 20% inactive, 3% banned
insert into users
select g,
  'user' || g || '@example.com',
  'User ' || g,
  case when h < 40 then 'IN' when h < 65 then 'US' when h < 75 then 'DE' when h < 83 then 'BR'
       when h < 90 then 'GB' when h < 95 then 'JP' when h < 98 then 'FR' else 'NG' end,
  case when s < 77 then 'active' when s < 97 then 'inactive' else 'banned' end,
  timestamptz '2022-01-01' + (abs(hashint4(g * 3)) % 730) * interval '1 day'
from generate_series(1, 20000) g,
  lateral (select abs(hashint4(g)) % 100 as h, abs(hashint4(g * 7)) % 100 as s) x;

insert into products
select g, 1 + abs(hashint4(g)) % 40, 'Product ' || g, (100 + abs(hashint4(g * 5)) % 19900) / 100.0
from generate_series(1, 2000) g;

-- 1 to 5 distinct products per order, priced at the product's price
insert into order_items
select o, p.id, 1 + abs(hashint4(o * 7 + k)) % 3, p.price
from generate_series(1, 100000) o,
  lateral generate_series(1, 1 + abs(hashint4(o * 13)) % 5) k,
  lateral (select 1 + (abs(hashint4(o)) + k * 397) % 2000 as pid) x
  join products p on p.id = x.pid;

-- user_id = 1 + floor(20000 * r^2) with r uniform in [0, 1): low ids order far more often
insert into orders
select g,
  1 + floor(20000 * power((abs(hashint4(g * 17)) % 1000000) / 1000000.0, 2))::int,
  case when st < 70 then 'delivered' when st < 85 then 'shipped' when st < 93 then 'paid'
       when st < 97 then 'pending' when st < 99 then 'cancelled' else 'refunded' end,
  timestamptz '2023-01-01' + (g * interval '630 seconds') + (abs(hashint4(g * 19)) % 600) * interval '1 second',
  coalesce(t.total, 0)
from generate_series(1, 100000) g
  cross join lateral (select abs(hashint4(g * 11)) % 100 as st) s
  left join (select order_id, sum(qty * price) as total from order_items group by order_id) t on t.order_id = g;

alter table categories add primary key (id);
alter table users add primary key (id);
alter table products add primary key (id);
alter table orders add primary key (id);
alter table order_items add primary key (order_id, product_id);
alter table users add constraint users_email_key unique (email);
alter table products add foreign key (category_id) references categories;
alter table orders add foreign key (user_id) references users;
alter table order_items add foreign key (order_id) references orders;
alter table order_items add foreign key (product_id) references products;

create table events (id bigint not null, user_id int not null, kind text not null, at timestamptz not null) partition by range (at);
do $$
begin
  for m in 1..12 loop
    execute format('create table events_2024_%s partition of events for values from (%L) to (%L)',
      lpad(m::text, 2, '0'), make_date(2024, m, 1), make_date(2024, m, 1) + interval '1 month');
  end loop;
end $$;
insert into events
select g, 1 + abs(hashint4(g)) % 20000,
  (array['view','view','view','view','click','click','add_to_cart','purchase'])[1 + abs(hashint4(g * 3)) % 8],
  timestamptz '2024-01-01' + (g * interval '525 seconds')
from generate_series(1, 60000) g;

-- A sample at least as large as each table makes ANALYZE read every row, so the planner's estimates (and the
-- plans that depend on them) are the same on every machine and every reset. The setting lasts for the session.
set default_statistics_target = 1100;

-- Whoever loads this file must then run `vacuum analyze` as a separate statement (VACUUM cannot run inside the
-- implicit transaction of a multi-statement string). It gathers statistics and marks pages all-visible, so the
-- tables behave like settled production tables: index-only scans need no heap fetches.
