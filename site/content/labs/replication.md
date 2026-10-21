One database server is a single point of failure, and it can only answer so many reads. Replication keeps copies on other servers. The catch is that copying takes time, and what you give up while it happens is the interesting part. Write some data, read from a replica, then pull the plug on the primary.

<div data-widget="replication"></div>

## Try this

1. **Asynchronous mode.** Press Write twice, then read from a replica straight away. It answers, but with an old version. That is a *stale read*: the client was told the write succeeded, yet this node has not caught up.
2. **Let time pass.** Press "Let a tick pass" until the in-flight copies arrive and read again. Now it is current. The gap is the **replication lag**, and it grows with the delay slider.
3. **Crash the primary before the copies arrive.** Write a few times, crash the primary at once, then promote a replica. Writes the client was told succeeded are gone for good. Asynchronous replication buys speed by risking data.
4. **Switch to synchronous mode** and repeat. Each write now waits for every replica before it is acknowledged, so a crash loses nothing the client was told about. The cost is that every write takes as long as the slowest replica, and a replica that is down would block writes in a strict setup.
5. **Tick "Replica 2 is in another region" and try semi-synchronous mode.** A write is acknowledged as soon as *one* replica has it, so it no longer waits for the far one, and a crash still loses nothing the client was told about, because the nearer replica already has every acknowledged write. This is the common compromise: PostgreSQL's synchronous replication can wait for any one standby (or a quorum) instead of all of them.
6. **Read your own writes.** In asynchronous mode, write, then press "Read through the load balancer" straight away: it can land on a replica that is still behind, and the user does not see what they just saved. Tick "Read your own writes" and repeat: while a replica is behind, the writer's reads go to the primary. Real systems do this by routing a user's reads to the primary for a short time after they write, or by waiting until a replica has reached the write's position in the log.

## What this shows

- **Replication improves availability and read capacity**, as the [master-slave replication](#master-slave-replication) section describes: if the master goes offline the system can keep serving reads until a slave is promoted.
- **It is not free.** The README lists the costs: data can be lost if the master fails before new writes are replicated, replicas can be bogged down replaying writes, and more replicas means more lag. See [the disadvantages of replication](#disadvantages-replication).
- **Reads from replicas are eventually consistent.** That is the trade-off behind [eventual consistency](#eventual-consistency) and the [CAP theorem](#cap-theorem). Try the [CAP lab](site:labs/cap-theorem/) for what happens when the network itself fails.
- **Master-master** setups let both nodes accept writes and need conflict handling; see [master-master replication](#master-master-replication).

## What the model leaves out

Real systems add many refinements: write-ahead log shipping, automatic failover with leader election (and protection against two primaries at once, "split brain"), and replication of schema changes. Lag here is measured in ticks; on a real system it is reported in bytes of log or in seconds. The point here is the single trade-off that sits under all of them: **how long you wait versus how much you can lose**.
