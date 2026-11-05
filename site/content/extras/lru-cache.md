### The one idea

A cache that evicts the **least recently used** entry has to answer three questions fast: is this key here, which entry was touched longest ago, and how do I mark an entry as just used. A hash map answers the first in O(1). A list ordered by recency answers the other two, if you can move an entry to the front and remove the one at the back in O(1). That points to a **doubly linked list** beside the hash map: the map finds the node, and the list orders them.

### How to get there in an interview

1. **Pin down the behaviour.** Fixed capacity. `get` returns the value, or nothing on a miss, and counts as a use. `set` on an existing key updates it and counts as a use. `set` on a new key when full removes the least recently used entry first.
2. **Start with the obvious version and say what is wrong with it.** A plain list of pairs makes every lookup O(n). A map plus a "last used" timestamp makes lookup fast, but evicting means scanning every entry for the oldest, which is O(n) again.
3. **Name what you need.** O(1) lookup by key, O(1) "move this entry to the front", and O(1) "remove the entry at the back". Only a doubly linked list can unlink a node it was handed without searching for its neighbour. A singly linked list cannot, because deleting a node needs the node before it.
4. **Choose the classes.** A `Node` that stores the key as well as the value, because when the tail node is evicted you must also delete its key from the map. A cache class that owns the map and the two end markers.
5. **Use sentinel nodes** at both ends so you never have to special-case an empty list or a one-element list.

### A working version

This is complete and runs as written. Both operations are O(1).

```python title="lru_cache.py"
class Node:
    def __init__(self, key=None, value=None):
        self.key = key
        self.value = value
        self.prev = None
        self.next = None


class LRUCache:
    def __init__(self, capacity):
        if capacity < 1:
            raise ValueError('capacity must be at least 1')
        self.capacity = capacity
        self.lookup = {}            # key -> Node
        self.head = Node()          # sentinel on the most recently used side
        self.tail = Node()          # sentinel on the least recently used side
        self.head.next = self.tail
        self.tail.prev = self.head

    def _unlink(self, node):
        node.prev.next = node.next
        node.next.prev = node.prev

    def _push_front(self, node):
        node.next = self.head.next
        node.prev = self.head
        self.head.next.prev = node
        self.head.next = node

    def get(self, key):
        node = self.lookup.get(key)
        if node is None:
            return None
        self._unlink(node)
        self._push_front(node)
        return node.value

    def set(self, key, value):
        node = self.lookup.get(key)
        if node is not None:                 # existing key: update and mark as used
            node.value = value
            self._unlink(node)
            self._push_front(node)
            return
        if len(self.lookup) == self.capacity:  # full: drop the least recently used
            oldest = self.tail.prev
            self._unlink(oldest)
            del self.lookup[oldest.key]
        node = Node(key, value)
        self.lookup[key] = node
        self._push_front(node)
```

Try it:

```python
cache = LRUCache(2)
cache.set('a', 1)
cache.set('b', 2)
cache.get('a')               # 'a' is now the most recently used
cache.set('c', 3)            # the cache is full, so the least recently used ('b') goes
assert cache.get('b') is None
assert cache.get('a') == 1 and cache.get('c') == 3
cache.set('a', 10)           # updating counts as a use
cache.set('d', 4)            # evicts 'c', not 'a'
assert cache.get('c') is None and cache.get('a') == 10
```

### What is wrong with the sketch above

The solution on this page is an outline, and some of it cannot run. Each of these was checked by running the code:

- **The list methods are empty** (`move_to_front`, `append_to_front` and `remove_from_tail` contain only `pass`). As soon as the cache is full, `set` fails with `AttributeError: 'NoneType' object has no attribute 'query'`, because the list never recorded a tail.
- **`Node` has no key.** `set` reads `tail.query`, but `Node` only stores `results`. Without the key you cannot remove the evicted entry from the map.
- **`self.next = next` stores Python's built-in `next` function**, not a pointer to another node. It is a typo for `None`.
- **There is no `prev` pointer.** Without one, removing the tail in O(1) is impossible, which is the reason the list is doubly linked.
- The arguments are `set(results, query)`, which is the reverse of the usual (key, value) order and is easy to get wrong.

Spotting problems like these in a design you have been handed is itself a useful interview skill.

### Questions to expect next

- **Thread safety.** Two threads moving nodes at once corrupt the list. The simple answer is one lock around `get` and `set`. Under heavy contention you can split the cache into several independent shards, each with its own lock.
- **Expiry.** Store a deadline in each node and treat an expired entry as a miss, removing it lazily when it is touched.
- **Size by bytes instead of by count.** Track a running total and evict from the tail until the new entry fits.
- **Is LRU the right policy?** Not always. A one-off scan of cold data can flush your hot entries. See the [cache eviction lab](site:labs/cache-eviction/) to compare it with LFU, FIFO and random on the same traffic.
- **Across many servers.** Each server holds its own LRU, and requests are routed by key with [consistent hashing](site:labs/consistent-hashing/). The [cache page](#cache) covers where caches fit in a larger system.
- In Python you can build this in a few lines from `collections.OrderedDict` with `move_to_end`. Interviewers usually want to see the linked-list-plus-map design, because it shows you understand why it is O(1).
