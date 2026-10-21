Two of the first ideas in system design are easy to mix up. [Latency](#latency-vs-throughput) is how long one request takes. [Throughput](#latency-vs-throughput) is how many requests are completed per second. They are linked, and the link explains why a system that is fast for a single user can still fall over under load. Move the sliders and watch the marker travel along the curve.

<div data-widget="load-curve"></div>

## Try this

1. **Leave the defaults and look at where the marker sits.** Eight servers at 75% busy is already well up the curve, and each request takes four times as long as it would on an idle server.
2. **Add servers.** The marker slides left, and latency drops sharply even though no individual server got faster. That is [horizontal scaling](#horizontal-scaling), and the reason it pays: you buy headroom, not speed.
3. **Raise incoming traffic** until demand reaches total capacity. Past that point requests arrive faster than they are served and the queue grows without limit.
4. **Lower the service time** and notice that the *shape* of the curve does not change. Making each request cheaper helps, but the knee near full utilisation is there regardless.

## What this shows

- **Performance and scalability are different problems.** The README separates them: with a performance problem the system is slow for a single user; with a scalability problem it is fast for one user and slow under heavy load. The idle service time is the first. The curve is the second. See [performance vs scalability](#performance-vs-scalability).
- **Latency is never free, and then it explodes.** Waiting starts as soon as requests can collide: at 50% busy a request already takes twice its idle time, at 75% four times, at 90% ten times and at 99% a hundred times. The rise is gentle at first and steep near the end, which is why running hot to save money is a bad trade: the last stretch of capacity costs the most in response time, and that is why the usual target is to keep servers at around 70% or below.
- **Throughput is capped by capacity; latency is not.** Throughput rises with load until the servers are full, then flattens. Latency keeps climbing.
- **This is why [load balancers](#load-balancer) and spare capacity matter**, and why the usual target is to keep servers well under full utilisation.

## About the model

The curve is the textbook result for one queue with random arrivals (an M/M/1 queue): average time in the system equals the idle service time divided by one minus utilisation. Each server is treated as its own queue, which is how a load balancer that picks a server per request behaves. Tick **Compare with one shared queue** to see the other textbook case (an M/M/c queue): every server takes the next request from one common line, so no request waits behind a slow one while another server sits idle. At the default 75% busy on eight servers a request takes about 24 ms instead of 80 ms, and the gap grows with more servers. That is why a balancer that sends work to the least busy server ([least connections](site:labs/load-balancing/)) behaves better than one that picks blindly, and why worker pools pull from one queue. Real systems have uneven requests, many queues and limits like connection pools, so the exact numbers differ. The shape, flat then steeply rising, is what carries over.
