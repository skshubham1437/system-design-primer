A cache is smaller than the data behind it, so something must be evicted when it fills up. Pick a traffic pattern and a cache size, then compare policies on the same sequence of requests.

<div data-widget="cache-eviction"></div>

## The policies

- **LRU (least recently used)** evicts the entry untouched the longest. A strong default because recent use predicts near-future use.
- **LFU (least frequently used)** evicts the entry used the fewest times. Great for stable popularity, slow to adapt when popularity shifts.
- **FIFO** evicts the oldest entry regardless of use. Cheap and simple, and often surprisingly close to LRU.
- **Random** evicts a random entry. No bookkeeping at all.
- **2Q** puts keys seen once into a small first-in-first-out area and only promotes a key to the main LRU area when it is asked for again soon after (it remembers the names of keys it recently pushed out). One pass over cold data churns the small area and leaves the hot set alone.
- **Optimal** knows the future and always evicts the entry needed furthest ahead. It is impossible in practice and is shown only as the ceiling to compare against.

## What to notice

- On **hot keys with an occasional scan**, LRU lets one pass over cold data flush the hot set. LFU keeps it.
- On **hot keys**, popularity follows the usual real-world shape: a few keys get most requests and a long tail gets the rest. Every policy does reasonably, and a bigger cache helps every policy.
- On a **loop slightly larger than the cache**, LRU, FIFO and LFU miss every single time while the optimal policy still hits often. This is the classic worst case. **Random eviction does far better here** (about half the requests hit at the default size) because it sometimes keeps the key that is about to come back. Being clever about the past is exactly wrong when the past is a loop.
- On **uniform random** traffic the real policies land within about ten points of each other and far below optimal. Nothing can predict requests that carry no pattern.
- Hit rate matters because every miss pays the cost of the slow path. See [cache-aside](#cache-aside) and the rest of the [cache](#cache) page for how misses are served.

Implementing LRU is a standard interview exercise; the [LRU cache design](site:practice/object-oriented/lru-cache/) pairs a hash map with a linked list so both lookup and eviction are O(1).

## A fix for scans, and its price

On **Hot keys + scans** at the default size, 2Q hits about half the requests against 41% for LRU: the scan no longer flushes the hot keys. On plain **Hot keys** it does slightly worse than LRU (48% against 53%), because a newly popular key has to prove itself twice before it is protected. No policy helps the **Loop**. That is the general shape of the trade-off: every policy is a bet about what the traffic looks like.

## What the model leaves out

Real caches also expire entries after a time to live, and most production caches approximate these policies rather than track them exactly: Redis, for example, samples a few keys and evicts the best candidate among them. 2Q, shown here, and newer designs such as TinyLFU exist precisely to stop one scan from flushing the hot set.
