A network call can fail in a way that leaves the caller not knowing whether it worked. The obvious answer is to try again, but that is only safe if doing the work twice has the same effect as doing it once. That property is **idempotence**. HTTP defines it as multiple identical requests having the same intended effect on the server as a single one. `GET`, `PUT` and `DELETE` are idempotent, and `POST` is not. "Design a payment API" and "how do you make this retry safe?" are common interview questions.

The trouble with a charge is that the client's view of a failure is the same whatever actually happened. Fail one payment at each point below and compare what each policy does.

<div data-widget="idempotency"></div>

## Try this

1. **Read down the "Retry, no key" column.** Some rows charge once and some charge twice. Nothing the client can see tells those rows apart: all of them are a timeout with no reply.
2. **Now read the "No retry" column.** Nothing is charged twice, but the client never learns the result. The customer sees an error, and may well pay again by hand.
3. **Choose "Reply lost" under "Retry with a key"** and play it. The retry finds the key and gets the saved response. The client learns what happened, and the card is charged once.
4. **Choose "Reply slower than the timeout" with a key.** The retry arrives while the first attempt is still running. The server cannot return a result it does not have yet, so it refuses with a conflict, and the client tries again shortly.
5. **Switch the key handling to "Saved separately".** Most rows stay correct, but a crash between the charge and saving the key now charges twice. The safety comes from the two being one transaction, not from having a key.
6. **Try "New key each try" and "Key expired".** Both turn the key column back into the plain retry column for the failures that matter.

## Why the client cannot tell

A request can fail at three points, and only the third is dangerous to repeat:

| What failed | Did it take effect? | Is a blind retry safe? |
|---|---|---|
| The connection, before reaching the server | No | Yes |
| The server, while processing | Depends on how far it got | Unknown |
| The response, after the work finished | Yes | No: it does the work again |

So a client that retries has to assume the worst case, and the server has to make repeating harmless. Some operations are harmless to repeat by nature: "set the address to X" can be repeated freely, and "add 10 to the balance" cannot. Where you can, write operations in the first form. A charge has to happen once however it is phrased, and that needs a key.

## How an idempotency key works

The client makes a unique key once for each operation and sends it with every attempt:

```text
POST /charges
Idempotency-Key: "8e03978e-40d5-43e8-bc93-6894a57f9324"
```

The server records the key with the outcome of the first attempt. A later attempt with the same key gets that outcome back and does no new work. The IETF is standardising this header in a [draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/), and Stripe and AWS both run the same idea at scale. The details are where designs go wrong:

| Decision | What to do | Where it comes from |
|---|---|---|
| **Who makes the key** | The client, once, before the first attempt. A random UUID is the usual choice. | Stripe suggests V4 UUIDs. The AWS SDKs generate a token and reuse it on retries. |
| **Saving it** | In the same transaction as the work, so neither can exist without the other. | AWS: the operation must be all or nothing. |
| **The same key with a different request** | Refuse it: this is a bug in the client. | The draft says 422. Stripe and AWS also return an error. |
| **A retry during the first attempt** | Refuse it, and let the client try again. | The draft says 409. |
| **A missing key where one is required** | Refuse it. | The draft says 400. |
| **What a retry gets back** | The first attempt's outcome. | Stripe v1 saves the status code and body and replays them, including 500 errors. AWS returns a response with the same meaning. |
| **How long to keep it** | Longer than any client keeps retrying, and publish the period. | Stripe v1 may remove keys once they are at least 24 hours old. The draft says to publish the policy. |

Two more points come up in interviews. A key belongs to a caller, so a key from one customer must not match another customer's. And do not put personal data in a key, because it will appear in logs. Stripe warns against using email addresses.

## Queues need this too

Message queues usually deliver **at least once**: a consumer can crash after doing the work and before acknowledging it, so the message comes back. A transactional outbox makes the same trade on the sending side: the message is saved in the same transaction as the business data and a relay publishes it, but the relay can crash after publishing and publish it again. In both cases the consumer has to tolerate duplicates, usually by recording the IDs of messages it has already processed.

This is what people mean by "exactly once" in practice: delivery may repeat, and processing is idempotent, so the effect happens once. See the [queue lab](site:labs/message-queue/).

## Retrying without causing an outage

Safe retries can still hurt. A retry is extra load, sent when the server is least able to take it. Here 1,000 clients all fail at the same moment, and all of them retry.

<div data-widget="retry-storm"></div>

### Try this

1. **Start with "Exponential".** Waiting 1, 2, 4, 8 seconds outlasts the outage, but every client waits the same time. They come back together in spikes far above the dashed capacity line, and the server sits idle between spikes.
2. **Switch to "Full jitter".** The ceilings are the same, but each client picks a random wait below them. On these settings all 1,000 get through, against 400 without jitter, with fewer requests and sooner.
3. **Try "Immediate".** With 8 attempts and a 10-second outage, every client uses up its attempts while the server is still down.
4. **Lengthen the outage, or lower the capacity,** and see which policies hold up.

### The rules

- **Back off exponentially, with jitter.** The AWS SDKs use `delay = random(0, 1) × min(cap, base × 2^retry)`, with a cap of 20 seconds. This is the full jitter in the simulation. The AWS Architecture Blog compared the variants and found un-jittered backoff the clear loser.
- **Limit attempts.** Every retry loop needs a stop. The AWS SDKs default to 3 attempts in all, the first included.
- **Retry at one layer.** Retries multiply through a call stack, because each layer retries the layer below. The Google SRE book's example is 4 attempts at each of 3 layers, which makes 64 attempts on the database for one user action. Amazon's is 3 at each of 5 layers, or 243 times the load.
- **Budget retries across requests.** Limiting each request is not enough when every request is failing. The SRE book suggests a budget per process, such as 60 retries a minute, and not retrying once it is spent. The AWS SDKs' retry quota is a token bucket with the same purpose: a transient retry costs 14 of 500 tokens, and when they run out the SDK returns the error at once.
- **Only retry what might succeed.** Server errors and timeouts may clear. Client errors generally will not, so fix the request. A `429` means slow down, and may say for how long with `Retry-After`; see the [rate limiting lab](site:labs/rate-limiting/).
- **Set the timeout with care.** A timeout shorter than the work takes means retrying requests that were about to succeed. That is the "Reply slower than the timeout" row above, and it adds load at the worst moment.

## What the model leaves out

The payment model has one fault, on the first attempt, and a healthy network afterwards. Real failures repeat, and real clients may give up between attempts. In the storm model a server answers at a fixed rate once it is back, while a real overloaded server often does worse as load rises, which makes retries more harmful than shown. All the clients fail at one moment; steady traffic spreads failures out and softens the waves. What each model does show is why a retry needs a key, and why retries need randomness.

## Sources and further reading

- [RFC 9110, Idempotent methods](https://www.rfc-editor.org/rfc/rfc9110#name-idempotent-methods): the definition, which methods qualify, and when a client may retry automatically.
- IETF draft, [The Idempotency-Key HTTP header field](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/): the header, and the 400, 409 and 422 responses. It is still a draft.
- Stripe, [Idempotent requests](https://docs.stripe.com/api/idempotent_requests): what is saved, for how long, and how reused keys are checked.
- Stripe, [Designing robust and predictable APIs with idempotency](https://stripe.com/blog/idempotency): the three points of failure.
- Amazon Builders' Library, [Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/): client tokens, atomic recording and mismatched parameters.
- Amazon Builders' Library, [Timeouts, retries and backoff with jitter](https://builder.aws.com/content/3EumjoZascWd1oZiEgL8ORlv3qE/timeouts-retries-and-backoff-with-jitter): retrying at one layer, and retry token buckets.
- AWS SDKs and Tools, [Retry behavior](https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html): the backoff formula, default attempts and retry quota. The page describes the updated 2026 behaviour, which is opt-in until it becomes the default.
- AWS Architecture Blog, [Exponential backoff and jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/): a comparison of the jitter variants.
- Google SRE book, [Addressing cascading failures](https://sre.google/sre-book/addressing-cascading-failures/): retry budgets and multiplying retries.
- Microservices.io, [Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html): why consumers must be idempotent.
