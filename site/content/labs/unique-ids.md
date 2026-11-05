On one database, an ID is easy: a counter hands out the next number. Once several machines create records, or the data is split across shards, a single counter becomes a bottleneck and a single point of failure, and "just use a random number" raises its own questions. "Design a unique ID generator" is a common interview question, and it also comes up inside larger designs such as a URL shortener or a timeline.

Start by asking what the ID has to do. Does it have to fit in 64 bits? Must it sort by creation time? Can it reveal how many records exist, or when one was made? Can creating a record depend on another service being up? Each scheme below answers these differently. Run them on the same requests, then break something.

<div data-widget="id-schemes"></div>

## Try this

1. **Compare the shapes on "Normal".** The auto-increment line is straight: issue order and sort order are the same. UUIDv4 is a cloud, because it is random. UUIDv7 and Snowflake look like straight lines too, but they make no call to a database: they get their order from the clock.
2. **Choose "Database down".** Auto-increment cannot make IDs at all, so nothing can be created. Ticket servers carry on using the other server, but the odd server returns behind, so its IDs sort before ones issued hundreds of milliseconds earlier. The schemes that need no database do not notice.
3. **Choose "Stale failover".** The replica that takes over has not seen the latest IDs, so it issues them again. Compare the duplicates column.
4. **Choose "Clock jumps back" on Snowflake.** With the guard on, requests wait until the clock catches up. Turn the guard off and the same times and sequence numbers are used again: duplicates. UUIDv7 does not duplicate here, because its random bits differ, but it does go out of order.
5. **Choose "Clock runs ahead".** Time-based IDs are only as ordered as the clocks are. The worst gap is the skew.
6. **Choose "Shared machine id".** One configuration mistake makes Snowflake collide on every millisecond of the run. A scheme with no central service needs its machine ids assigned correctly.
7. **Choose "Burst".** The 12-bit sequence allows 4,096 IDs per machine per millisecond. The rest wait for the next millisecond. The database schemes have no such limit in this model, but look at their calls.

## The options

| Scheme | Bits | Central service at runtime | Sorted by time | Main weakness |
|---|---|---|---|---|
| Auto-increment | 32 or 64 | yes: the database | yes, on one server | a bottleneck and single point of failure; reveals how many records exist |
| Ticket servers | 64 | yes: the ticket servers | roughly | a call for every ID; another system to run |
| UUIDv4 | 128 | no | no | large; poor index locality |
| UUIDv7 | 128 | no | to the millisecond, if clocks agree | large; reveals when a record was made |
| Snowflake style | 64 | no, but machine ids must be assigned | to the millisecond, if clocks agree | depends on clocks; reveals when a record was made |

## Auto-increment and sequences

A database counter is the simplest choice and often the right one: the IDs are small, they mostly sort by time, and an index handles them well. Some details catch people out:

- **Gaps are normal.** In PostgreSQL a value taken from a sequence is not given back if the transaction aborts, so aborts and crashes leave gaps. PostgreSQL's documentation says plainly that sequences cannot produce gapless numbering. If you need gapless invoice numbers, you need a different design, and it costs concurrency.
- **Order is not guaranteed once values are cached.** With `CACHE` greater than one, each session reserves a block. PostgreSQL's example has session A holding 1 to 10 and session B holding 11 to 20, so B can return 11 before A returns 2.
- **Several writable servers need separate ranges.** MySQL's `auto_increment_increment` and `auto_increment_offset` set the step and the start, so with a step of 2 one server issues odd numbers and the other even ones.
- **Failover can reuse IDs.** A replica that is behind has not seen the latest values. In 2012, GitHub's cluster promoted a MySQL node that was out of date. Redis lookups keyed by MySQL-generated IDs no longer matched for records created in that window: events appeared on the wrong users' dashboards, and 16 private repositories were accessible to people outside their collaborators for seven minutes.
- **Public IDs leak.** A counter in a URL tells anyone how many orders you have, and invites them to try the next number.

## Ticket servers

Flickr needed IDs across its sharded MySQL databases and kept the counter idea by moving it to dedicated servers. Each ID comes from `REPLACE INTO Tickets64 (stub) VALUES ('a')` followed by `SELECT LAST_INSERT_ID()`, which updates a single row and returns a new number. Two servers provide availability, one issuing odd numbers and one even. Flickr noted that the two drift out of sync, with a few hundred thousand more odd-numbered objects, and that this hurts no one. The price is a call to another service for each ID.

## UUIDs

A UUID has 128 bits, and needs no coordination at all, because the chance of two machines choosing the same value is negligible. RFC 9562 defines the versions that matter here:

- **UUIDv4** has 122 random bits. It reveals nothing, but new values land all over an index. The RFC says versions that are not time ordered have poor database-index locality.
- **UUIDv7** starts with a 48-bit Unix timestamp in milliseconds, followed by 74 bits that are random by default. New values land near each other in an index. The RFC says to use it instead of versions 1 and 6 where possible. PostgreSQL 18 has a built-in `uuidv7()`.

Store UUIDs as 128-bit binary values rather than text, as the RFC advises. And do not treat one as a secret: the RFC says UUIDs must not be used as security capabilities, and that implementations should not assume they are hard to guess.

## Snowflake-style IDs

Twitter's Snowflake packs an ID into 64 bits, so it fits an ordinary `BIGINT`:

| Field | Bits | What it gives |
|---|---|---|
| Time | 41 | milliseconds from a custom epoch: 69 years |
| Machine id | 10 | up to 1,024 machines |
| Sequence | 12 | 4,096 IDs per machine per millisecond |

Each machine needs no network call to issue an ID, so issuing is fast, and IDs from one machine never repeat as long as its id is unique and its clock does not go back. The cost is depending on clocks. The README says to run NTP in a mode that will not move the clock backwards, and says Snowflake refuses to generate IDs until the time is after the last one it used. Its IDs are "k-sorted": roughly ordered, within a bound it promised as one second and aimed to keep to tens of milliseconds.

The layout is a set of trade-offs, not a standard. Discord uses a 42-bit timestamp from an epoch at the start of 2015, a 5-bit worker, a 5-bit process and a 12-bit increment. One more practical catch: JavaScript numbers hold integers exactly only up to 2^53, so 64-bit IDs must travel as strings in JSON that a browser will read.

## Sorted IDs and shards

Sorted IDs have a cost that depends on where the data lives. They are good for a single B-tree, since inserts stay together. On a store split by key range, they are bad: every new row belongs at the end of the range, so one shard takes all the writes. Google's Spanner documentation warns against a monotonic first key column for this reason, and suggests UUIDv4, a hash of the key, or a bit-reversed sequence instead. With a time-sorted ID on a range-sharded store, hash the ID, or put another column first. See the [sharding lab](site:labs/sharding/).

## How soon random IDs collide

Random IDs repeat far earlier than the size of the space suggests. Each new ID can match any earlier one, so the number of pairs grows with the square of the IDs made. This is the birthday problem.

<div data-widget="id-collisions"></div>

The chance of a repeat among n random IDs from a space of size d is about 1 − e^(−n²/2d). A 50% chance arrives at about 1.18 times the square root of d:

| ID | Possible values | IDs for a 50% chance of a repeat |
|---|---|---|
| 32 random bits | about 4.3 billion | about 77,000 |
| 7 base 62 characters | about 3.5 trillion | about 2.2 million |
| 64 random bits | about 18 quintillion | about 5.1 billion |
| UUIDv4, 122 random bits | about 5.3 × 10^36 | about 2.7 × 10^18 |

The [Pastebin solution](site:practice/system-design/pastebin/) takes 7 base 62 characters, for 62^7 values and 360 million links in 3 years. There are plenty of values, but at 360 million links about 18,400 pairs would match. That design still works, because its primary key on the short link makes a duplicate insert fail, so the code has to catch that and try another value. A random ID shorter than a UUID needs that check.

## Which to choose

- **One database, private IDs:** auto-increment. Do not add complexity you do not need.
- **Many writers, IDs can be large, no sorting needed:** UUIDv4. It suits stores where random keys spread the writes.
- **Many writers, one B-tree per shard, sorted IDs help:** UUIDv7.
- **As above, but it must fit 64 bits:** Snowflake style, with a plan for assigning machine ids and handling clocks.
- **Short IDs for people to read or type:** random characters with a uniqueness check on insert, or an encoded counter if it may be guessable.

## What the model leaves out

Time is exact, the four servers are perfectly regular, and each database call takes no time, so the "database calls" column only counts them. Real databases have a limit, and real systems often fetch IDs in blocks to reduce the calls. The UUIDv7 here uses only milliseconds and random bits, while real implementations may add a counter or finer time to stay sorted within a millisecond. The failures are single, clean events. The IDs and comparisons are real.

## Sources and further reading

- [RFC 9562, Universally Unique IDentifiers](https://www.rfc-editor.org/rfc/rfc9562.html): the layouts of UUIDv4 and UUIDv7, sorting, storage and security.
- Twitter, [Snowflake README](https://github.com/twitter-archive/snowflake/tree/snowflake-2010): the 41, 10 and 12 bit layout, k-sorting and how it handles clocks.
- Discord, [Snowflakes](https://docs.discord.com/developers/reference): a different split of the same 64 bits.
- Flickr, [Ticket servers: distributed unique primary keys on the cheap](https://code.flickr.net/2010/02/08/ticket-servers-distributed-unique-primary-keys-on-the-cheap/): `REPLACE INTO`, and odds and evens.
- PostgreSQL 18, [Sequence manipulation functions](https://www.postgresql.org/docs/18/functions-sequence.html), [CREATE SEQUENCE](https://www.postgresql.org/docs/18/sql-createsequence.html) and [UUID functions](https://www.postgresql.org/docs/18/functions-uuid.html): gaps, cached values and `uuidv7()`.
- MySQL 8.4, [Replication source options](https://dev.mysql.com/doc/refman/8.4/en/replication-options-source.html): `auto_increment_increment` and `auto_increment_offset`.
- GitHub, [GitHub availability this week](https://github.blog/news-insights/the-library/github-availability-this-week/): the September 2012 incident.
- Google Cloud, [Spanner schema design best practices](https://docs.cloud.google.com/spanner/docs/schema-design): hotspots from monotonic keys, and what to use instead.
- Wikipedia, [Birthday problem](https://en.wikipedia.org/wiki/Birthday_problem): the approximation, and the table of hash sizes.
