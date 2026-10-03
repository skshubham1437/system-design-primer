When a cache or database is spread over several servers, something has to decide which server owns each key. The obvious answer, `hash(key) mod N`, has a nasty property: change N and almost every key lands somewhere new. Consistent hashing fixes that. Add or remove a node below and compare how many keys have to move.

<div data-widget="consistent-hash"></div>

## How it works

1. Hash every node onto a circle (the ring). Each node can appear several times as **virtual nodes**.
2. Hash each key onto the same circle.
3. A key belongs to the first node you meet walking clockwise from its position.

Adding a node only takes over the arc between it and its predecessor, so on average just `1/N` of the keys move. Removing a node hands its arc to the next node clockwise.

## What to notice

- **One virtual node per server gives a lopsided ring.** Arcs have random lengths, so one server can own several times its fair share. Raise the virtual-node slider and watch the bars level out.
- **Compare the "keys moved" figures.** Modulo hashing reshuffles most keys on every change, which in a cache means a flood of misses hitting the database at once.
- **Removing a node** spreads its load across many neighbours when each node has many virtual nodes, rather than dumping it all on one.

## Where it shows up

[Sharding](#sharding), distributed [caches](#cache) such as Memcached clients, and Dynamo-style [wide-column and key-value stores](#nosql) all use some form of it. It is also the usual answer to "how do you add a cache server without a stampede?".
