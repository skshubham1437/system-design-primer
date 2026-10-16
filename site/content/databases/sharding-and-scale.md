Everything else in this section makes one database server do less work per query. Eventually one server is not enough, and the data or the traffic has to be spread over several. There are three tools for that, and they solve different problems. This page connects them to the parts of the site that cover each in depth.

## Three ways to use more than one machine

| | Replication | Partitioning | Sharding |
|---|---|---|---|
| What is split | nothing: whole copies | one table into pieces | the data across servers |
| Where it lives | several servers, same data | one server | several servers, different data |
| Helps with | read load, availability | huge tables, deleting old data, query pruning | write load, data larger than one machine |
| Main cost | replica lag, failover | constraints must include the key | cross-shard queries and transactions, rebalancing |
| Learn more | [replication lab](site:labs/replication/), [replication](#replication) | [partitioning](site:databases/partitioning/) | [sharding lab](site:labs/sharding/), [sharding](#sharding) |

## Read replicas first

Most applications read far more than they write. Replicas copy every change from the primary through its [write-ahead log](site:databases/how-rows-are-stored/) and can serve reads. The catch is lag: a replica may be slightly behind, so a user who just saved something may not see it if the next read goes to a replica. Send reads that must see the user's own writes to the primary, or wait until the replica has caught up. The [replication lab](site:labs/replication/) shows stale reads and what a crash costs.

## Sharding when writes or size outgrow one server

Sharding puts different rows on different servers, chosen by a **shard key** such as the customer id. Each server handles a fraction of the writes and holds a fraction of the data. Everything that was easy on one server becomes a design decision:

- **Choosing the key.** Queries that include the shard key go to one shard; queries that do not must ask every shard and merge the answers. Pick the key from your most important queries. The [sharding lab](site:labs/sharding/) compares range, hash and lookup-table placement.
- **Moving data when shards are added.** Placing keys with [consistent hashing](site:labs/consistent-hashing/) means only a small share of keys move when the number of shards changes.
- **Joins and transactions across shards** are slow or unavailable. Keep data that is used together on the same shard (all of one customer's rows, for example).
- **Hot keys.** One very busy customer still lands on one shard, however even the key distribution looks.

Systems such as Citus (an extension that distributes PostgreSQL tables across nodes) and Vitess (for MySQL) do much of this routing for you, but the key-choice trade-offs above remain.

## In what order

The [scaling story](site:labs/scaling-story/) walks through the usual sequence: tune queries and indexes first (the rest of this section), then add caching and read replicas, then split by function ([federation](#federation)), and shard only when nothing else is enough. Each step adds complexity that you then have to operate, so take it when measurements say you need it.

## Sources

- PostgreSQL documentation: *High Availability, Load Balancing, and Replication*, *Table Partitioning*.
- Citus documentation: *Choosing the Distribution Column*. Vitess documentation: *Sharding*.
- The System Design Primer sections on replication, federation and sharding.
