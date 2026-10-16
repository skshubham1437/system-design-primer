Twelve slow queries from an online shop, each with a real cause and a real fix. For each one, read the scenario, explain the query, decide what is wrong, and change the schema or the query. The database judges your answer by the plan it actually chooses, not by matching your text, so any correct fix passes.

How each check works:

- Your changes (for example a `CREATE INDEX`) and your query run inside a transaction that is rolled back afterwards, so every attempt starts from the same data.
- Checks look at the plan: which kinds of step it uses, how many pages it reads, how many rows it reads and throws away. Never at timings, which depend on your machine.
- Your query must return exactly the same rows as the original. Making a query fast by making it wrong does not count.
- Hints go from a nudge to the answer. Your attempts and solved exercises are saved in this browser and shown on [your progress](site:progress/) page.

If you are new to plans, read [Reading EXPLAIN](site:databases/reading-plans/) first, or warm up in the [playground](site:databases/playground/).

## Getting started

<div data-widget="sql-exercise" data-id="orders-for-one-user"></div>

<div data-widget="sql-exercise" data-id="login-by-email"></div>

<div data-widget="sql-exercise" data-id="who-bought-a-product"></div>

## Indexes that fit the query

<div data-widget="sql-exercise" data-id="signups-on-a-day"></div>

<div data-widget="sql-exercise" data-id="recent-pending-orders"></div>

<div data-widget="sql-exercise" data-id="order-history-covering"></div>

<div data-widget="sql-exercise" data-id="newest-signups-by-country"></div>

## Rewriting the query

<div data-widget="sql-exercise" data-id="deep-pagination"></div>

<div data-widget="sql-exercise" data-id="events-in-a-month"></div>

<div data-widget="sql-exercise" data-id="subquery-per-row"></div>

## When the plan itself goes wrong

<div data-widget="sql-exercise" data-id="stale-statistics"></div>

<div data-widget="sql-exercise" data-id="sort-spills"></div>
