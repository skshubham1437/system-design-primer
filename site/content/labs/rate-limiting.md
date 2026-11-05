A rate limiter caps how many requests a client can make in a period of time, for example 100 a minute per API key. It protects a service from one heavy or misbehaving client, keeps costs predictable, and makes abuse such as password guessing slow. Requests over the limit are refused, usually with HTTP status **429 Too Many Requests**, or made to wait. "Design an API rate limiter" is also a common interview question.

There are five classic ways to count. They agree on the average rate and differ in what they allow in a short burst, how much memory they need, and whether they refuse or delay. Send the same requests through each.

<div data-widget="rate-limit"></div>

## Try this

1. **Fixed window on "Window edges".** A burst of 10 arrives just before a one-second boundary and another 10 just after it. The fixed window counts each second separately, so it allows all 20: twice the limit within a fraction of a second. The busiest second is shaded red.
2. **Switch to the sliding log** on the same traffic. It looks at the real last second every time, so the second burst is refused and no second ever serves more than the limit.
3. **Try the sliding counter.** It gets close to the sliding log's result from just two counts per client. The estimate assumes the previous window's requests were spread evenly, so it can be slightly off.
4. **Choose "Bursts" and the token bucket**, then raise the bucket size. A full bucket lets a burst through at once and then refills at the limit. That is usually what an API wants: idle clients may catch up, but the long-run rate is still capped.
5. **Now the leaky bucket.** Its output is perfectly even, and nothing is refused while its queue has room. Look at the orange lines: that is how long requests waited. Smooth output costs latency.
6. **Compare the table.** It runs all five limiters on the current traffic. Change the traffic or the limit and the table updates.

## The five algorithms

| Algorithm | Stores per client | Bursts | Main weakness |
|---|---|---|---|
| Fixed window | one counter | up to twice the limit across a boundary | the boundary burst |
| Sliding log | one timestamp per allowed request | never above the limit | memory grows with the limit |
| Sliding counter | two counters | close to the limit | an estimate, not exact |
| Token bucket | a token count and a time | up to the bucket size, by design | two numbers to tune |
| Leaky bucket (queue) | a queue | none: output is steady | requests wait |

Token bucket and sliding counter are the common choices for APIs. The token bucket's burst allowance suits clients that are idle and then busy, and both need only a few numbers per client.

## Where the limit lives

- **What to count by.** An API key or user id is the usual key. An IP address works for anonymous traffic but is shared by everyone behind the same NAT or office network, so a limit per IP can block many innocent users at once.
- **Where to check.** The earliest cheap place is best: an API gateway, the [load balancer](#load-balancer) or a [reverse proxy](#reverse-proxy-web-server), before a request costs any real work. Limits that depend on business rules, such as "10 exports a day on the free plan", belong in the application.
- **Different costs.** An endpoint that runs a heavy report can spend more tokens per call than one that reads a single record.

## Rate limiting across many servers

Each web server keeping its own counter does not work: with ten servers behind a load balancer, a client can make ten times its limit. The usual fixes:

- **A shared counter** in a fast in-memory store such as Redis (see [cache](#cache)), keyed by client and window. The check and the increment must be one atomic operation (for example `INCR` followed by setting an expiry, or a small server-side script), or two servers can both read "99", both allow, and both write "100".
- **The cost is a network round trip on every request**, and the store becomes something the API depends on. Decide in advance whether to allow or refuse requests if it is unreachable.
- **Approximate local limits.** Each server enforces a share of the limit and syncs counts every few seconds. That is cheaper and slightly less exact.
- **Route by key.** If the load balancer always sends a given API key to the same server (consistent hashing helps), that server's local counter is the whole truth.

## What clients should do

- **Respect the 429.** The response can include a `Retry-After` header saying how long to wait. Many APIs also report the limit and what is left in response headers, and the IETF is standardising `RateLimit` header fields for this.
- **Back off exponentially, with jitter.** Retrying immediately makes an overload worse. Wait longer after each failure (for example 1, 2, 4, 8 seconds) and add randomness so that thousands of clients do not all retry at the same moment.
- **Only retry what is safe to repeat.** A retried payment must not charge twice. An idempotency key sent with the request lets the server recognise a retry of a request it already handled. The [idempotency lab](site:labs/idempotency/) shows this, and what jitter does.

Rate limiting and [back pressure](#back-pressure) are the same idea from two sides: refusing work you cannot do, so the work you accept stays fast. The [queue lab](site:labs/message-queue/) shows what happens without it.

## What the model leaves out

Real limiters run per client, usually across several servers sharing a store, and often combine limits (a per-second burst limit plus a per-day quota). The traffic here comes from one client and time is exact. The behaviour that matters for a design, what each algorithm lets through in a burst and what it costs, is what is shown.

## Sources and further reading

- [RFC 6585, section 4](https://www.rfc-editor.org/rfc/rfc6585#section-4): the 429 Too Many Requests status code.
- [RFC 9110, Retry-After](https://www.rfc-editor.org/rfc/rfc9110#name-retry-after) and the IETF draft [RateLimit header fields for HTTP](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/).
- Stripe, [Scaling your API with rate limiters](https://stripe.com/blog/rate-limiters): the token bucket, and the different kinds of limiter Stripe runs.
- Cloudflare, [How we built rate limiting capable of scaling to millions of domains](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/): the sliding counter approximation.
- Amazon API Gateway, [Throttle requests to your REST APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-request-throttling.html): throttling with a token bucket.
- Redis, [INCR](https://redis.io/docs/latest/commands/incr/): the rate limiter patterns built on an atomic counter.
- AWS Architecture Blog, [Exponential backoff and jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/).
