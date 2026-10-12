Every large system started as one small one. Following a single product as it grows is the quickest way to see **why** each building block exists: each stage below starts with a symptom, adds one component to fix it, and says what that costs. It follows the same arc as the [scale to millions of users on AWS](site:practice/system-design/scaling-aws/) solution.

<div data-widget="scale-story"></div>

## The nine stages

### 1. One server does everything

**Symptom.** None yet. A few hundred users, one machine running the web server, the application and the database.

**Fix.** Nothing needed. Keep it simple while it works.

**Cost.** Everything fails together. If the machine dies or one busy page hogs it, the whole product is down, and you cannot scale any part separately.

### 2. Give the database its own server

**Symptom.** The web code and the database fight over the same CPU and memory, and you cannot add capacity for one without the other.

**Fix.** Put the [database](#database) on a separate machine and let the [application layer](#application-layer) talk to it over the network.

**Cost.** Every query now crosses a network, and there are two things to run and keep healthy instead of one.

### 3. Add DNS and a load balancer, and clone the web servers

**Symptom.** One web server is the limit, and it is also a single point of failure.

**Fix.** Run several identical web servers behind a [load balancer](#load-balancer), found through [DNS](#domain-name-system). Make the servers **stateless**: keep sessions in a shared store, not in a server's memory, so any server can handle any request. This is [horizontal scaling](#horizontal-scaling).

**Cost.** Servers must hold no user data. The load balancer is now the single point of failure, so you run more than one. The database now takes connections from many servers.

### 4. Cache the hot reads

**Symptom.** The database is busy answering the same questions again and again.

**Fix.** Put an in-memory [cache](#cache) such as Redis or Memcached between the application and the database, using the [cache-aside](#cache-aside) pattern.

**Cost.** Cached data can be stale, and deciding when to update or remove it is one of the harder problems in the field. A cold cache makes the first requests slow.

### 5. Replicate the database

**Symptom.** Reads still outnumber what one database can serve, and a database failure would take the product down.

**Fix.** Keep a primary that takes writes and one or more replicas that serve reads, as in [master-slave replication](#master-slave-replication). A replica can be promoted if the primary fails.

**Cost.** Replicas lag behind, so a read may be stale, and a failure just before replication can lose recent writes. Try the [replication visual](site:labs/replication/).

### 6. Serve static files from a CDN

**Symptom.** Images, scripts and video use a lot of bandwidth, and users far from your servers see slow pages.

**Fix.** Put static content on a [content delivery network](#content-delivery-network) so it is served from a location near each user and your servers never see those requests.

**Cost.** Content can be out of date until its TTL expires, and URLs for static files have to point at the CDN. See the [CDN visual](site:labs/cdn/).

### 7. Move slow work to a queue

**Symptom.** Some requests do heavy work, such as resizing an image or sending email, and the user waits for it.

**Fix.** Have the web server write a job to a [message queue](#message-queues) and reply at once, while separate workers do the work in the background.

**Cost.** The work finishes later, not immediately. There are more moving parts, and if jobs arrive faster than workers finish them the queue grows, which is why [back pressure](#back-pressure) matters. See the [queue visual](site:labs/message-queue/).

### 8. Split the data

**Symptom.** The single write primary is saturated, or one table has become too large to handle well.

**Fix.** Split the data: by function with [federation](#federation), across servers with [sharding](#sharding), or move suitable data to a [NoSQL](#sql-or-nosql) store. See [how sharding strategies compare](site:labs/sharding/).

**Cost.** Joins across shards become hard, the application must know where data lives, and rebalancing is complex. This is the most expensive step to take, so take it last.

### 9. Run in more than one region

**Symptom.** Users on another continent are far from your servers, and a whole data centre outage would take you offline.

**Fix.** Run a second copy of the stack in another region and route users to the nearest one with latency-based or geolocation [DNS](#domain-name-system), using an [active-active](#active-active) setup.

**Cost.** Keeping data in step across regions forces the trade-off in the [CAP theorem](#cap-theorem): during a network split you choose between consistency and availability. See the [CAP lab](site:labs/cap-theorem/).

## What to take from it

- **Add a component to fix a measured problem**, not before. The solutions say the same: benchmark, profile, then address the bottleneck, and repeat.
- **Every fix has a cost**, and the cost is usually the next stage's symptom. Caches create staleness, replicas create lag, queues create delay.
- **The order is a pattern, not a rule.** A system with heavy writes may need stage 8 early; a mostly static site may never leave stage 6.
