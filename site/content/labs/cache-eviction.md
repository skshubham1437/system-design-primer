A cache is smaller than the data behind it, so something must be evicted when it fills up. Pick a traffic pattern and a cache size, then compare policies on the same sequence of requests.

<div data-widget="cache-eviction"></div>

## The policies

- **LRU (least recently used)** evicts the entry untouched the longest. A strong default because recent use predicts near-future use.
- **LFU (least frequently used)** evicts the entry used the fewest times. Great for stable popularity, slow to adapt when popularity shifts.
- **FIFO** evicts the oldest entry regardless of use. Cheap and simple, and often surprisingly close to LRU.
- **Random** evicts a random entry. No bookkeeping at all.
- **Optimal** knows the future and always evicts the entry needed furthest ahead. It is impossible in practice and is shown only as the ceiling to compare against.

## What to notice

- On **hot keys with an occasional scan**, LRU lets one pass over cold data flush the hot set. LFU keeps it.
- On a **loop slightly larger than the cache**, LRU and FIFO miss every single time while the optimal policy still hits often. This is the classic worst case.
- On **uniform random** traffic the real policies land within a few points of each other and far below optimal. Nothing can predict requests that carry no pattern.
- Hit rate matters because every miss pays the cost of the slow path. See [cache-aside](#cache-aside) and the rest of the [cache](#cache) page for how misses are served.

Implementing LRU is a standard interview exercise; the [LRU cache design](#object-oriented-design-interview-questions-with-solutions) pairs a hash map with a linked list so both lookup and eviction are O(1).
