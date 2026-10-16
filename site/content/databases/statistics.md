Every choice the planner makes, which index, which join, how much memory, starts from one number: how many rows it expects each step to produce. It gets that number from statistics that `ANALYZE` gathers about each column. When a plan is bad, a bad estimate is the most common reason, so it pays to know what the planner knows and what it has to guess.

## What ANALYZE collects

For each column, `ANALYZE` stores a summary in `pg_stats`: the fraction of nulls, an estimate of how many distinct values there are, the **most common values** with their frequencies, and a **histogram** of the remaining values split into buckets of equal population.

```sql run
select attname as column_name, null_frac, n_distinct,
       array_length(most_common_vals::text::text[], 1) as common_values,
       array_length(histogram_bounds::text::text[], 1) as histogram_bounds
from pg_stats
where tablename = 'orders' and attname in ('status', 'user_id', 'total')
order by attname;
```

A negative `n_distinct` is a fraction of the row count (−1 means every value is unique). For `status` every value fits in the most-common list, so the planner knows the exact share of each.

```sql run
select most_common_vals as status, most_common_freqs as frequency
from pg_stats
where tablename = 'orders' and attname = 'status';
```

## How an estimate is made

For `status = 'pending'` the planner multiplies the table's row count by the frequency of `pending` in the most-common list. For a range such as `total > 2000` it finds where 2,000 falls in the histogram. For a value that is in neither, it spreads what is left evenly over the remaining distinct values.

```sql explain
select * from orders where status = 'pending';
```

```sql explain
select * from orders where total > 2000;
```

Two simplifications cause most bad estimates:

- **Columns are assumed independent.** For `a = 1 and b = 2` the planner multiplies the two selectivities. When the columns are related, such as a city and its country, that underestimates badly.
- **Expressions have no statistics.** `where total * 1.18 > 2400` uses a fixed default guess, because nothing is known about `total * 1.18` (see [reading plans](site:databases/reading-plans/)). An index on the expression gets its own statistics.

## Correlated columns

A small table of addresses in 30 cities spread over 10 countries, three cities to each country, so the city decides the country. It is created and analysed inside this example:

```sql setup
create table addresses as
select g as id,
       'city ' || (g % 30) as city,
       'country ' || (g % 30 / 3) as country
from generate_series(1, 60000) g;
analyze addresses;
```

```sql explain-analyze
select count(*) from addresses where city = 'city 7' and country = 'country 2';
```

The planner multiplied one-thirtieth (the city) by one-tenth (the country) and expected a tenth of the real count: every address in city 7 is in country 2, so the second condition removes nothing. **Extended statistics** tell it the columns depend on each other:

```sql setup
create statistics addresses_city_country (dependencies) on city, country from addresses;
analyze addresses;
```

```sql explain-analyze
select count(*) from addresses where city = 'city 7' and country = 'country 2';
```

Now the estimate matches. `CREATE STATISTICS` also supports `ndistinct` (for grouping by several columns) and `mcv` (most common combinations).

## Keeping statistics fresh

Autovacuum runs `ANALYZE` on a table after enough of it has changed. Between those runs, after a large import or delete, the statistics describe data that is no longer there. Run `ANALYZE` yourself after bulk changes, before the queries that depend on them. The [stale statistics](site:databases/tuning-exercises/) exercise shows a 30,000-row import turning a good plan into a terrible one until the table is analysed.

By default `ANALYZE` reads a random sample of 300 × `default_statistics_target` rows (30,000 with the default target of 100), and keeps up to 100 most-common values and histogram buckets per column. For a column with a skewed distribution, raise the target for that column only: `alter table orders alter column user_id set statistics 500`. (The sample database on this site sets the target high enough to read every row, so that estimates are identical on every machine.)

## In MySQL

*Not run here; from the MySQL reference manual.* InnoDB samples index pages to estimate row counts (persistent statistics, refreshed by `ANALYZE TABLE` or automatically after about 10% of a table changes). Since 8.0, `ANALYZE TABLE … UPDATE HISTOGRAM ON column` adds histograms for columns, which the optimizer uses for conditions on columns without an index.

## Sources

- PostgreSQL documentation: *Statistics Used by the Planner*, *Row Estimation Examples*, *pg_stats*, *ANALYZE*, *CREATE STATISTICS*, *Extended Statistics*, *The Autovacuum Daemon*, `default_statistics_target`.
- MySQL reference manual: *Configuring Persistent Optimizer Statistics Parameters*, *Optimizer Statistics* (histograms).
