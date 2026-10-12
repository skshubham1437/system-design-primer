### The one idea

A hash map turns a key into a number, and uses the number as an index into an array. The array is much smaller than the set of possible keys, so different keys will sometimes land on the same slot. How you handle that **collision** is the heart of the design. This exercise uses **chaining**: each slot holds a small list of the items that landed there.

### How to get there in an interview

1. **Pin down the scope.** Integer keys only, chaining for collisions, no need to worry about load factors, inputs are valid. Say these back so the interviewer can correct any of them.
2. **Describe the operations.** `set(key, value)` adds a key or replaces its value, `get(key)` returns the value or fails if the key is missing, `remove(key)` deletes it.
3. **Choose the hash function.** For integer keys, `key % size` is a fair start: it always gives a valid index. Mention that a real map must also hash strings and other types, and that a poor hash function sends many keys to the same slot.
4. **Choose the structure.** An array of `size` buckets, each a list. Store the key as well as the value in each item, because after hashing you have to compare keys to tell which item in the bucket you want.
5. **State the cost.** With a good spread, each bucket is short, so all three operations are O(1) on average. If every key lands in one bucket, they are O(n).

### The solution, and a check that it works

The solution on this page is complete and correct for its constraints. Keys 1 and 5 collide when the table has 4 slots, and both are still found:

```python
class Item:
    def __init__(self, key, value):
        self.key = key
        self.value = value


class HashTable:
    def __init__(self, size):
        self.size = size
        self.table = [[] for _ in range(size)]

    def _hash_function(self, key):
        return key % self.size

    def set(self, key, value):
        bucket = self.table[self._hash_function(key)]
        for item in bucket:
            if item.key == key:
                item.value = value
                return
        bucket.append(Item(key, value))

    def get(self, key):
        for item in self.table[self._hash_function(key)]:
            if item.key == key:
                return item.value
        raise KeyError('Key not found')

    def remove(self, key):
        bucket = self.table[self._hash_function(key)]
        for index, item in enumerate(bucket):
            if item.key == key:
                del bucket[index]
                return
        raise KeyError('Key not found')


table = HashTable(4)
table.set(1, 'a')
table.set(5, 'b')                     # 5 % 4 == 1, so this collides with key 1
table.set(1, 'c')                     # replaces the value, does not add a second item
assert table.get(1) == 'c' and table.get(5) == 'b'
assert [len(bucket) for bucket in table.table] == [0, 2, 0, 0]   # both live in slot 1
table.remove(1)
assert table.get(5) == 'b'
try:
    table.get(1)
except KeyError:
    pass
else:
    raise AssertionError('removed key should be gone')
```

### The part the exercise leaves out: growing

The constraints say not to worry about load factors, but an interviewer will often ask. The **load factor** is items divided by slots. As it rises, buckets get longer and every operation slows towards O(n). The usual fix is to **resize**: when the load factor passes a threshold such as 0.75, allocate a table with twice as many slots and re-insert every item, because each item's slot depends on the table size.

```python
class ResizingHashTable(HashTable):
    MAX_LOAD = 0.75

    def __init__(self, size=8):
        super().__init__(size)
        self.count = 0

    def set(self, key, value):
        is_new = all(item.key != key for item in self.table[self._hash_function(key)])
        super().set(key, value)
        if is_new:
            self.count += 1
            if self.count / self.size > self.MAX_LOAD:
                self._grow()

    def remove(self, key):
        super().remove(key)
        self.count -= 1

    def _grow(self):
        items = [item for bucket in self.table for item in bucket]
        self.size *= 2
        self.table = [[] for _ in range(self.size)]
        for item in items:
            self.table[self._hash_function(item.key)].append(item)


big = ResizingHashTable(size=4)
for n in range(100):
    big.set(n, n * n)
assert big.size > 4 and big.count / big.size <= 0.75
assert all(big.get(n) == n * n for n in range(100))
assert max(len(bucket) for bucket in big.table) < 10   # buckets stay short
```

Resizing makes a single `set` occasionally O(n), but it happens rarely enough that the cost averaged over many inserts is still O(1). That is called **amortized** O(1).

### Questions to expect next

- **Other ways to handle collisions.** *Open addressing* stores items in the array itself and probes for the next free slot. It uses less memory per item and is friendlier to the CPU cache, but deletion is trickier and it degrades sharply when nearly full.
- **Non-integer keys.** Hash the key to an integer first, for example with a string hash, then take it modulo the size.
- **Why a power-of-two size is common.** It lets the modulo be a fast bit mask, but it makes a weak hash function worse, so the two choices go together.
- **The same idea at scale.** Spreading keys across servers instead of slots is the problem [consistent hashing](site:labs/consistent-hashing/) solves, and hashing is the basis of [sharding](#sharding). Compare strategies in the [sharding lab](site:labs/sharding/).
