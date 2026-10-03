Back-of-the-envelope estimates are the first thing an interviewer looks for after you have scoped the problem. Fill in a few assumptions and see what the system has to survive. Everything runs in your browser.

<div data-widget="estimator"></div>

## How to read the numbers

**QPS (queries per second)** is the daily request count divided by 86,400 seconds. Traffic is never flat, so the **peak** figure multiplies the average by a peak factor. Size the system for the peak, not the average.

**Storage** grows by the number of writes times the size of each write. Multiply by the retention period for the long-term footprint, and by the replication factor for what you actually have to buy.

**Bandwidth** is QPS times payload size. Ingress is the data written; egress is the data served. Egress is usually the larger of the two in read-heavy systems, and it is what a [CDN](#content-delivery-network) takes off your servers.

**Cache size** follows the 80/20 rule of thumb: a small share of items serves most reads, so a [cache](#cache) holding that share of a day's reads can absorb most of the load.

## What to say out loud

1. State each assumption and round aggressively. 2.5 million seconds per month and 100,000 seconds per day are close enough.
2. Compute reads and writes separately; their ratio decides your design more than either number alone.
3. Say what the numbers imply, such as sharding, caching or a CDN, rather than stopping at the arithmetic.

Useful reference tables: [powers of two](#powers-of-two-table) and [latency numbers](#latency-numbers-every-programmer-should-know). The [Pastebin solution](#design-pastebincom-or-bitly) works through this same calculation by hand.
