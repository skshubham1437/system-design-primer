Observability is being able to understand what a running system is doing from the outside, using what it emits, including for problems nobody predicted. Monitoring is the part that watches for known conditions and tells you when one occurs. A design that scales but cannot be debugged at 3 a.m. is unfinished, and interviewers often ask how you would know your system is healthy, and what you would look at when it is not.

## Three signals

Systems emit three kinds of data. Each answers a different question, so you need all three, and it helps a great deal if they can be linked.

| Signal | What it is | The question it answers | Its weakness |
|---|---|---|---|
| **Metrics** | numbers measured over time | Is something wrong, and how much? | no detail about any one request |
| **Traces** | the path of one request through the services | Where did this request spend its time? | usually only a sample is kept |
| **Logs** | timestamped records of events | What exactly happened here? | expensive at volume, and no overview |

A typical investigation moves through them in that order: an alert fires on a metric, a trace shows which service is slow, and the logs for that trace show why.

## Logs

Prefer **structured logs**, with consistent named fields, over free text. A consistent schema makes logs easy to parse and analyse at scale, and to link with traces:

```json
{"time": "2026-11-05T09:30:00Z", "level": "error", "service": "checkout", "msg": "charge failed", "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736", "order_id": "A1042"}
```

The field that does the most work is the trace ID: it turns "all the logs" into "the logs for this one request". Keep secrets and personal data out of logs, and remember that logging every request at high traffic is a real cost.

## Metrics

Most metrics are one of three kinds:

- A **counter** only goes up, like total requests. Its rate of change is what you graph.
- A **gauge** is a current value, like queue length or memory in use.
- A **histogram** counts values into buckets, like request duration. This is how you get percentiles.

Two mistakes are common.

**Trusting the average.** Averages hide what users feel. The Google SRE book's example is a service averaging 100 ms at 1,000 requests a second, where 1% of requests might easily take 5 seconds. That is 10 requests every second, and the rest would be averaging about 50 ms, which looks fine on a graph. Look at percentiles such as the 99th. The SRE book suggests counting requests into latency buckets with roughly exponential boundaries.

The tail also grows with fan-out. If one server is slow on 1% of requests, a request that needs 100 such servers in parallel is slow 63% of the time, as [The Tail at Scale](https://www.barroso.org/publications/TheTailAtScale.pdf) shows. The slowest response decides. The same paper describes one fix, hedged requests: send a second copy after a short delay and use whichever answers first.

**Averaging percentiles, or adding too many labels.** Percentiles computed on each instance cannot be combined: the Prometheus documentation warns that averaging them gives statistically nonsensical values. Sum histogram buckets across instances and compute the percentile from the total. An estimate is only as good as its buckets, though: Prometheus's example has a true value of 220 ms reported as 295 ms from a 200 to 300 ms bucket.

Every unique combination of label values is a new time series, so the count multiplies. 5 methods, 20 routes and 5 status codes make 500 series, which is fine. Add a user ID label with a million users and it is 500 million. Prometheus's guidance is not to use labels for unbounded values such as user IDs or email addresses. Put those in logs and traces instead.

## What to measure

You do not need to invent a list. Three short ones are widely used:

| Method | For | Measure |
|---|---|---|
| **The four golden signals** | any user-facing system | latency, traffic, errors, saturation |
| **RED** | request-driven services | rate, errors, duration |
| **USE** | resources such as CPUs and disks | utilisation, saturation, errors |

Some details from the SRE book are worth repeating in an interview. Track the latency of successes and failures separately, since a fast error can flatter your average. Count requests that return a success with wrong content, or that are too slow to be useful, as errors. And saturation matters before 100%, since performance often degrades earlier, as the [load curve lab](site:labs/load-curve/) shows.

## Traces

A **trace** records the path of one request. It is made of **spans**, each a unit of work with a start and an end, such as a service call or a database query. Every span in a trace shares a trace ID, and each records its parent, which gives a tree:

```text
GET /checkout                       root span: the whole request
├─ auth-service: verify token
├─ cart-service: load cart
│  └─ database: SELECT items
└─ payment-service: charge
   └─ card network: authorise
```

For this to work across services, the IDs must travel with the request. This is **context propagation**. The standard is the W3C `traceparent` header, which carries a version, a 16-byte trace ID, an 8-byte parent ID and flags, including whether the trace is sampled:

```text
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

One service that fails to pass the header on breaks the trace in two, which is why tracing is usually built into shared libraries. Google's Dapper paper names restricting instrumentation to a few common libraries as one of the choices key to its success, along with sampling.

**Sampling** keeps the cost down, and the OpenTelemetry documentation says a rate of 1% or lower often suffices at high volume. There are two ways to decide:

- **Head sampling** decides at the start of the request. It is simple and cheap, but it cannot know yet whether this request will fail or be slow.
- **Tail sampling** decides after seeing most of the trace, so it can keep the errors and the slow ones. It needs stateful components that use real resources and are hard to run.

## SLIs, SLOs and SLAs

These three terms are often confused, and interviewers notice.

| Term | What it is | Example |
|---|---|---|
| **SLI**, indicator | a measurement of the service | the share of requests answered successfully |
| **SLO**, objective | a target for an SLI | 99.9% of requests succeed, over 30 days |
| **SLA**, agreement | a contract with consequences for missing the SLOs in it | service credits if the objective is missed |

To tell an SLO from an SLA, ask what happens when it is missed. If nothing explicit happens, it is an SLO. Latency objectives are usually layered, as in the SRE book's example: 90% of calls under 1 ms, 99% under 10 ms and 99.9% under 100 ms. Do not simply adopt today's performance as the target, avoid absolutes such as "always available", and keep the internal target tighter than anything you publish.

## Error budgets

An SLO of 99.9% also says that 0.1% of requests may fail. That allowance is the **error budget**, and it turns "how reliable should we be?" into something a team can spend:

| SLO | Budget over 30 days, if everything fails |
|---|---|
| 99% | 7.2 hours |
| 99.9% | 43.2 minutes |
| 99.95% | 21.6 minutes |
| 99.99% | 4.32 minutes |

While budget remains, new releases can go out. When it is used up, the SRE book's policy is that releases halt until reliability recovers. The [nines calculator](site:learn/availability-patterns/) works through the same arithmetic.

## Alerting

Page people for **symptoms**, not causes. High CPU may mean nothing, while users getting errors always matters. The SRE book asks that every page be urgent, actionable and require human judgment. A page that only needs a robotic response should be automated.

The best symptom to alert on is the rate at which the budget is being spent. **Burn rate** measures that: at a burn rate of 1 the budget lasts exactly the window, and at 2 it lasts half that. For a 99.9% SLO over 30 days, a burn rate of 1 means a 0.1% error rate and a burn rate of 10 means 1%, which uses up the budget in 3 days. The SRE Workbook recommends alerting at several speeds:

| Severity | Burn rate | Long window | Short window | Budget spent when it fires |
|---|---|---|---|---|
| Page | 14.4 | 1 hour | 5 minutes | 2% |
| Page | 6 | 6 hours | 30 minutes | 5% |
| Ticket | 1 | 3 days | 6 hours | 10% |

An alert fires only if both windows are over the burn rate. The long window means it is sustained, and the short one means it is still happening, so the alert clears soon after the errors stop.

Low traffic breaks this. With 10 requests an hour, one failure is a 10% error rate, which would page immediately against a 99.9% SLO. The Workbook's options include generating synthetic traffic, combining related services, and lowering the SLO or lengthening the window.

## In an interview

When you finish a design, a few sentences are usually enough:

- **Define healthy from the user's side.** Name one or two SLIs and an SLO, such as the share of timeline reads that succeed within a latency target.
- **Say what you would graph:** RED for each service, plus saturation for the part most likely to run out, such as the queue length or the database connections.
- **Say how you would debug.** Propagate a trace ID through every service and put it in every log line.
- **Say what pages someone,** and that it is a burn rate on the SLO rather than a CPU threshold.
- **Mention the cost.** Sample traces, keep label values bounded, and limit log volume.

## Sources and further reading

- Google SRE book, [Monitoring distributed systems](https://sre.google/sre-book/monitoring-distributed-systems/): the four golden signals, tail latency, and what makes a good page.
- Google SRE book, [Service level objectives](https://sre.google/sre-book/service-level-objectives/): SLI, SLO and SLA, and how to choose targets.
- Google SRE book, [Embracing risk](https://sre.google/sre-book/embracing-risk/): error budgets and release decisions.
- Google SRE Workbook, [Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/): burn rates, multiple windows, and low traffic.
- OpenTelemetry, [Observability primer](https://opentelemetry.io/docs/concepts/observability-primer/), [Logs](https://opentelemetry.io/docs/concepts/signals/logs/), [Metrics](https://opentelemetry.io/docs/concepts/signals/metrics/), [Traces](https://opentelemetry.io/docs/concepts/signals/traces/), [Context propagation](https://opentelemetry.io/docs/concepts/context-propagation/) and [Sampling](https://opentelemetry.io/docs/concepts/sampling/).
- W3C, [Trace Context](https://www.w3.org/TR/trace-context/): the `traceparent` header. The example above is the specification's.
- Prometheus, [Metric and label naming](https://prometheus.io/docs/practices/naming/) and [Histograms and summaries](https://prometheus.io/docs/practices/histograms/): cardinality, and combining percentiles.
- Dean and Barroso, [The Tail at Scale](https://www.barroso.org/publications/TheTailAtScale.pdf), Communications of the ACM, 2013: fan-out and hedged requests.
- Sigelman et al., [Dapper, a large-scale distributed systems tracing infrastructure](https://research.google/pubs/dapper-a-large-scale-distributed-systems-tracing-infrastructure/): Google's tracing system.
- Tom Wilkie, [The RED method](https://grafana.com/blog/the-red-method-how-to-instrument-your-services/), and Brendan Gregg, [The USE method](https://www.brendangregg.com/usemethod.html).
