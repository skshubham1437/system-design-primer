A [load balancer](#load-balancer) spreads requests over a pool of servers, but "evenly" can mean several different things. This simulation sends the same stream of requests, some quick and some slow, through each algorithm and measures what users would feel.

<div data-widget="load-balancing"></div>

## The algorithms

- **Round robin** takes servers in turn. Fair by count, blind to how long each request takes.
- **Random** needs no state and evens out over many requests.
- **Least connections** sends each request to the server with the fewest in flight. It adapts to slow requests, at the cost of tracking state.
- **Weighted round robin** gives stronger servers a larger share. Switch on mixed hardware to see why it matters.
- **IP hash** pins each client to one server, which keeps sessions sticky but follows whatever skew the clients have. A single heavy client overloads its server.

## What to notice

- With **identical servers**, round robin, random and least connections are in the same ballpark, and least connections wins on the average. IP hash is already the worst, because a couple of dozen clients cannot be spread evenly over a few servers.
- Turn on **mixed hardware**: plain round robin now overloads the small machines while the big ones idle.
- The **p95 latency** is where the pain shows. Averages hide the long queues behind one unlucky server.
- IP hash looks balanced by request count but not by work when one client is hot.

These are layer 7 decisions in [layer 4 vs layer 7 balancing](#layer-4-load-balancing) terms; hashing and connection counting can be done at either layer, while content-aware routing needs [layer 7](#layer-7-load-balancing). See also [horizontal scaling](#horizontal-scaling).
