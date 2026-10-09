### A pipe analogy

Picture a water pipe. **Latency** is how long one drop takes to get from one end to the other, which depends on the length of the pipe. **Throughput** is how much water comes out each second, which depends on its width. The two are independent. A long, wide pipe has high latency and high throughput, like a satellite link: lots of data, but each bit takes a long time to arrive. A short, narrow pipe is the opposite.

### Why you need to watch both

Suppose loading a page takes 50 requests made one after another, and each has 100 ms of latency. That is 5 seconds of waiting, and a faster connection does not help, because the time is spent on round trips rather than moving data. The cures are to make fewer round trips (batching, caching, [CDNs](#content-delivery-network)) or to make them in parallel.

Now suppose you are copying a terabyte between data centres. The first byte arriving 50 ms later hardly matters; what matters is how many bytes per second the link carries.

### They pull against each other

- **Batching** raises throughput, since handling many items at once is more efficient, but each item waits for the batch to fill, which adds latency.
- **Running close to full capacity** raises throughput, but queues build and latency climbs. The [load curve](site:labs/load-curve/) shows how sharply.
- **Caching** and **adding replicas** can improve both at once, which is why they are so common.

### A working rule

The README's guidance is to aim for **maximal throughput with acceptable latency**. For interactive requests where a person is waiting, set a latency target first (say, under a few hundred milliseconds at the 95th percentile) and get as much throughput as you can inside it. For background and batch work, favour throughput and let latency be whatever it needs to be.
