A network partition is not a hypothetical. Links drop, switches fail, regions lose contact. When it happens a replicated store has to choose: refuse requests to stay consistent, or keep answering and risk disagreeing. Run the experiment on three replicas.

<div data-widget="cap-lab"></div>

## Try this sequence

1. In **CP mode**, write a value with the network healthy. All three replicas agree.
2. **Cut the network** so node 3 is alone. Write on node 1: it succeeds, because nodes 1 and 2 are still a majority.
3. Try to **write or read on node 3**. CP mode refuses, since node 3 cannot prove it is current. The system gave up availability to stay consistent.
4. **Heal** the network. Node 3 catches up and everyone agrees again.
5. Switch to **AP mode** and repeat. Node 3 now answers, but with stale data.
6. In AP mode, **write on both sides** of the partition and then heal. The two sides disagree, and last-write-wins silently discards one update.

## What this shows

During a partition you can have consistency or availability, not both. This is the [CAP theorem](#cap-theorem). Without a partition you can have both, so the real design question is which to give up when the network misbehaves.

- **CP** systems suit data where being wrong costs more than being unavailable, such as balances and inventory. See [strong consistency](#strong-consistency).
- **AP** systems suit data where an answer now beats a perfect answer later, such as feeds and carts. See [eventual consistency](#eventual-consistency) and [weak consistency](#weak-consistency).
- Last-write-wins is the simplest way to reconcile, and it loses data. Real systems use version vectors, CRDTs or application-level merges when that matters.

Related: [availability patterns](#availability-patterns) and [replication](#replication).
