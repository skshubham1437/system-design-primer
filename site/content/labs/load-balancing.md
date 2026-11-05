A [load balancer](#load-balancer) spreads requests over a pool of servers, but "evenly" can mean several different things. This simulation sends the same stream of requests, some quick and some slow, through each algorithm and measures what users would feel.

<div data-widget="load-balancing"></div>

## The algorithms

- **Round robin** takes servers in turn. Fair by count, blind to how long each request takes.
- **Random** needs no state and evens out over many requests.
- **Least connections** sends each request to the server with the fewest in flight. It adapts to slow requests, at the cost of tracking state.
- **Weighted round robin** gives stronger servers a larger share. Switch on mixed hardware to see why it matters.
- **Power of two choices** picks two servers at random and sends the request to the less busy of the two. It needs far less shared state than least connections and gets most of its benefit, which is why many large systems use it.
- **IP hash** pins each client to one server, which keeps sessions sticky but follows whatever skew the clients have. A single heavy client overloads its server.

## What to notice

- With **identical servers**, least connections gives the lowest and the most predictable tail latency, because it notices when a server is stuck behind a slow request. Round robin comes next and random after it. IP hash is the worst, because a couple of dozen clients cannot be spread evenly over a few servers.
- Turn on **mixed hardware**: plain round robin now overloads the small machines while the big ones idle.
- The **p95 latency** is where the pain shows. Averages hide the long queues behind one unlucky server.
- **IP hash follows whatever skew the clients have.** Its requests per server are uneven even with ordinary traffic, and one hot client sends a large share of all requests to a single server. That is the price of keeping each client on the same server.
- **Look at the range, not just the median.** The table repeats each algorithm over 20 different traffic samples. Round robin's p95 can be good or bad depending on luck, while least connections stays in a narrow band. A single run, like a single benchmark, can mislead.

All of these algorithms can run at [layer 4](#layer-4-load-balancing), which sees only addresses and ports, or at [layer 7](#layer-7-load-balancing), which reads the request itself. Routing by content, such as sending video requests to video servers, needs layer 7. See also [horizontal scaling](#horizontal-scaling).

## When a server dies

Tick **Server 1 dies**. The server stops working but still accepts connections, which is the nastiest kind of failure: nothing errors, requests just wait.

- **Without health checks**, round robin, random and IP hash keep sending it their share, and every one of those requests is lost. Least connections loses far fewer by accident: the dead server's queue grows, so it stops being the least busy.
- **Turn on health checks.** After a few missed probes the balancer takes the server out of rotation and failures almost stop. Look at p95, though: it gets *worse*, because three servers now carry the work of four. Detecting a failure is only half the job; the other half is having spare capacity. This is why the [load balancer page](#load-balancer) lists health checks first, and why [availability patterns](#availability-patterns) talk about redundancy.
- Try the challenge: a few failed requests and a short tail at the same time.

## What the model leaves out

Real balancers retry a failed request on another server, drain connections gracefully before removing a server, and bring a recovered server back slowly so it is not flooded. Failed requests are left out of the latency figures here, which is also how many dashboards hide an outage: always look at error rates beside latency.
