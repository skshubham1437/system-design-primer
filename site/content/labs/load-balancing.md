A [load balancer](#load-balancer) spreads requests over a pool of servers, but "evenly" can mean several different things. This simulation sends the same stream of requests, some quick and some slow, through each algorithm and measures what users would feel.

<div data-widget="load-balancing"></div>

## The algorithms

- **Round robin** takes servers in turn. Fair by count, blind to how long each request takes.
- **Random** needs no state and evens out over many requests.
- **Least connections** sends each request to the server with the fewest in flight. It adapts to slow requests, at the cost of tracking state.
- **Weighted round robin** gives stronger servers a larger share. Switch on mixed hardware to see why it matters.
- **IP hash** pins each client to one server, which keeps sessions sticky but follows whatever skew the clients have. A single heavy client overloads its server.

## What to notice

- With **identical servers**, least connections gives the lowest and the most predictable tail latency, because it notices when a server is stuck behind a slow request. Round robin comes next and random after it. IP hash is the worst, because a couple of dozen clients cannot be spread evenly over a few servers.
- Turn on **mixed hardware**: plain round robin now overloads the small machines while the big ones idle.
- The **p95 latency** is where the pain shows. Averages hide the long queues behind one unlucky server.
- **IP hash follows whatever skew the clients have.** Its requests per server are uneven even with ordinary traffic, and one hot client sends a large share of all requests to a single server. That is the price of keeping each client on the same server.
- **Look at the range, not just the median.** The table repeats each algorithm over 20 different traffic samples. Round robin's p95 can be good or bad depending on luck, while least connections stays in a narrow band. A single run, like a single benchmark, can mislead.

All of these algorithms can run at [layer 4](#layer-4-load-balancing), which sees only addresses and ports, or at [layer 7](#layer-7-load-balancing), which reads the request itself. Routing by content, such as sending video requests to video servers, needs layer 7. See also [horizontal scaling](#horizontal-scaling).

## What the model leaves out

Real balancers also run health checks and stop sending traffic to a server that fails them, which is the main reason to have one. They retry failed requests, drain connections before a server is removed, and often use "power of two choices": pick two servers at random and send the request to the less busy one, which gets most of the benefit of least connections with far less shared state.
