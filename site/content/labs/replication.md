One database server is a single point of failure, and it can only answer so many reads. Replication keeps copies on other servers. The catch is that copying takes time, and what you give up while it happens is the interesting part. Write some data, read from a replica, then pull the plug on the primary.

<div data-widget="replication"></div>

## Try this

1. **Asynchronous mode.** Press Write twice, then read from a replica straight away. It answers, but with an old version. That is a *stale read*: the client was told the write succeeded, yet this node has not caught up.
2. **Let time pass.** Press "Let a tick pass" until the in-flight copies arrive and read again. Now it is current. The gap is the **replication lag**, and it grows with the delay slider.
3. **Crash the primary before the copies arrive.** Write a few times, crash the primary at once, then promote a replica. Writes the client was told succeeded are gone for good. Asynchronous replication buys speed by risking data.
4. **Switch to synchronous mode** and repeat. Each write now waits for every replica before it is acknowledged, so a crash loses nothing the client was told about. The cost is that every write takes as long as the slowest replica, and a replica that is down would block writes in a strict setup.

## What this shows

- **Replication improves availability and read capacity**, as the [master-slave replication](#master-slave-replication) section describes: if the master goes offline the system can keep serving reads until a slave is promoted.
- **It is not free.** The README lists the costs: data can be lost if the master fails before new writes are replicated, replicas can be bogged down replaying writes, and more replicas means more lag. See [the disadvantages of replication](#disadvantages-replication).
- **Reads from replicas are eventually consistent.** That is the trade-off behind [eventual consistency](#eventual-consistency) and the [CAP theorem](#cap-theorem). Try the [CAP lab](site:labs/cap-theorem/) for what happens when the network itself fails.
- **Master-master** setups let both nodes accept writes and need conflict handling; see [master-master replication](#master-master-replication).

## What the model leaves out

Real systems add many refinements: semi-synchronous modes where only one replica must confirm, write-ahead log shipping, automatic failover with leader election, and replication of schema changes. The point here is the single trade-off that sits under all of them: **how long you wait versus how much you can lose**.
