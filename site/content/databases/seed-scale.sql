-- The sample shop at 100 times the size, for the "at production scale" recordings (scripts/record-scale.mjs).
-- It never runs in the browser or the build: it is loaded once into a real PostgreSQL server in Docker, and the
-- recorded plans are committed. Same formulas as seed.sql, scaled:
--
--   users     2,000,000   (seed.sql: 20,000)   same country and status mix
--   orders   10,000,000   (seed.sql: 100,000)  same skew towards low user ids, same status mix, same date range
--
-- Differences, kept small on purpose: there is no order_items table (none of the recorded queries reads it), so an
-- order's total comes from a hash instead of the sum of its items; and orders are 6.3 seconds apart instead of
-- 630, so ten million of them still cover 2023 and 2024.

set timezone = 'UTC';

create table users (id int, email text not null, name text not null, country text not null, status text not null, created_at timestamptz not null);
create table orders (id int, user_id int not null, status text not null, created_at timestamptz not null, total numeric(12,2) not null);

insert into users
select g,
  'user' || g || '@example.com',
  'User ' || g,
  case when h < 40 then 'IN' when h < 65 then 'US' when h < 75 then 'DE' when h < 83 then 'BR'
       when h < 90 then 'GB' when h < 95 then 'JP' when h < 98 then 'FR' else 'NG' end,
  case when s < 77 then 'active' when s < 97 then 'inactive' else 'banned' end,
  timestamptz '2022-01-01' + (abs(hashint4(g * 3)) % 730) * interval '1 day'
from generate_series(1, 2000000) g,
  lateral (select abs(hashint4(g)) % 100 as h, abs(hashint4(g * 7)) % 100 as s) x;

insert into orders
select g,
  1 + floor(2000000 * power((abs(hashint4(g * 17)) % 1000000) / 1000000.0, 2))::int,
  case when st < 70 then 'delivered' when st < 85 then 'shipped' when st < 93 then 'paid'
       when st < 97 then 'pending' when st < 99 then 'cancelled' else 'refunded' end,
  timestamptz '2023-01-01' + (g * interval '6.3 seconds') + (abs(hashint4(g * 19)) % 6) * interval '1 second',
  (100 + abs(hashint4(g * 23)) % 99900) / 100.0
from generate_series(1, 10000000) g
  cross join lateral (select abs(hashint4(g * 11)) % 100 as st) s;

alter table users add primary key (id);
alter table orders add primary key (id);
alter table users add constraint users_email_key unique (email);
alter table orders add foreign key (user_id) references users;

-- Run `vacuum analyze` afterwards as a separate statement, as with seed.sql.
