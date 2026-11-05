Leaderless stores such as Cassandra, Riak and the design behind Amazon's Dynamo keep each item on several replicas and let any of them take reads and writes. Consistency then comes from simple arithmetic: how many replicas a write waits for, and how many a read asks. Change the numbers and see when a read can miss the latest write.

<div data-widget="quorum-lab"></div>

## Try this

1. **Keep N = 3, W = 2, R = 2 and press Write, then Read.** The read asks the two most out-of-date replicas, the worst case, and one of them still has the new value. With R + W = 4 > 3, any two replicas you read overlap any two you wrote.
2. **Set W = 1 and R = 1.** Write, then read: the read can land on a replica the write never reached and return the old value. Fast, and only eventually consistent. See [eventual consistency](#eventual-consistency).
3. **Press "Let replicas catch up"** and read again. Background repair (hinted handoff, read repair and anti-entropy in real systems) brings every replica up to date, so the stale answer goes away given time.
4. **Back to W = 2, R = 2: take one replica down.** Reads and writes still work. Take a second one down: writes are refused. The system chose consistency over availability, the trade-off in the [CAP theorem](#cap-theorem). Try W = 1 with two replicas down: writes are accepted again, but reads with R = 1 may be stale.
5. **Try N = 5 with W = 3, R = 3**: it tolerates two failures for both reads and writes, at the cost of more replicas answering every request.

## What this shows

- **R + W > N gives every read an overlap with the latest write.** Common settings are a majority for both (N = 3, W = 2, R = 2), or W = N, R = 1 for read-heavy data, or W = 1, R = N for write-heavy data.
- **Each quorum is also an availability limit.** A write needs W live replicas and a read needs R; with N = 3 and majorities, the system survives one failure.
- **Lower quorums are faster.** A request waits for the slowest of the replicas it needs, so W = 1 or R = 1 cuts latency, and gives up the overlap.

## What the model leaves out

Real systems also have to decide which value is newest when replicas disagree (timestamps or version vectors), repair stale replicas, and cope with "sloppy quorums" that count stand-in replicas during failures. Even R + W > N does not give full linearizability when writes are concurrent or fail part-way; it guarantees that a read sees a write that completed before the read began. Compare with the leader-based approach in the [replication lab](site:labs/replication/) and the partition behaviour in the [CAP lab](site:labs/cap-theorem/).
