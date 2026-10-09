[Sharding](#sharding) splits one big database into several smaller ones, each holding a subset of the data. The hard part is deciding which subset goes where. Here 600 users are spread across shards three different ways. Watch how much data and how much traffic each shard gets, and which queries now have to ask everyone.

<div data-widget="sharding"></div>

## Try this

1. **Start with "By surname".** Raise the shard count to 6. One shard ends up almost empty and others are crowded, because surnames are not spread evenly across the alphabet. Range sharding keeps related records together, but only as evenly as your data allows.
2. **Switch to "By hash of ID".** User counts even out, since a hash scatters users pseudo-randomly. Now look at the traffic bars with the power-user box ticked: a handful of very busy users can still make one shard hot, however evenly the *count* looks.
3. **Switch to "Lookup table".** Users are placed deliberately by load, so traffic comes out level. The cost is that the table itself must be stored, kept in sync and never become the bottleneck.
4. **Look at the queries.** Finding one user by the shard key touches one shard under every strategy. Finding everyone whose surname starts with M is cheap only under range sharding. Finding everyone in one city has to ask *every* shard and merge the answers, which is called scatter-gather.

## What this shows

- **Why sharding reduces load**: each shard sees less read and write traffic, holds a smaller index, and fails independently, as the [sharding](#sharding) section explains. It also lists the costs: application logic must know about shards, data can become lopsided, joins across shards are hard, and rebalancing is complex.
- **Lopsided distribution** is the first problem to plan for. A sharding function based on [consistent hashing](site:labs/consistent-hashing/) reduces how much data moves when shards are added or removed.
- **Choose the shard key for your queries.** Whatever you shard by is cheap to search by. Everything else becomes scatter-gather, which is why [denormalization](#denormalization) and secondary indexes show up alongside sharding.
- Sharding is different from [federation](#federation), which splits databases by *function* (users, forums, products) rather than splitting one table's rows.

## What the model leaves out

Real shards also need replicas, resharding without downtime, and cross-shard transactions. Treat the numbers here as a way to see the shape of the trade-off, not as a benchmark.
