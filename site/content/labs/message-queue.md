A [message queue](#message-queues) sits between a producer and its consumers so that neither has to wait for the other. That decoupling is powerful, and it hides a trap: a queue only absorbs *bursts*. If the producer is faster than the consumers for long enough, the queue just fills up. Set the rates and see.

<div data-widget="message-queue"></div>

## Try this

1. **Keep the defaults** (the producer sends 6 per tick, two consumers handle 2 each). The queue climbs to its limit and then starts dropping messages. More buffer only delays the problem.
2. **Add consumers** until their total reaches the producer's rate. The queue drains and stays short. Scaling the consumer side is the usual fix, which works well when the consumers are stateless.
3. **Turn on back pressure.** Once the queue is mostly full, the producer is held to what the consumers can take. Nothing is dropped. Instead the extra messages wait at the producer: watch the new "waiting at the producer" row fill up and the dashed line climb. Back pressure did not create capacity; it moved the queue upstream, where the producer (or its caller) has to wait, retry or shed load.
4. **Add consumers until they keep up, then press "Send a burst of 30".** A queue with room comfortably swallows a short spike, and with back pressure on, the burst waits at the producer briefly and then drains. A queue is the right tool for bursts and the wrong tool for a permanent mismatch.
5. **Step through it.** Pause, then press Step (or the right arrow key) to advance one tick at a time and read the numbers.

## What this shows

- **A queue converts a speed mismatch into waiting time.** The "wait for a new message" figure is how long the latest arrival waits in total: behind the producer's backlog first, then behind everything already in the queue.
- **Back pressure is about choosing where the pain goes.** The README describes it as limiting queue size to keep throughput and good response times for jobs already in the queue; once the queue is full, clients get a server-busy response and should retry later. See [back pressure](#back-pressure).
- **In a web system the same idea looks like a 503.** When the queue is full, clients get a server-busy response and retry later, ideally with exponential backoff. Here the producer simply slows down, which is the same pressure travelling upstream.
- **Dropping versus blocking** is a design decision, not an accident. Which one is right depends on whether losing a message is worse than slowing the sender.
- Queues also bring costs of their own; see the [disadvantages of asynchronism](#disadvantages-asynchronism), and compare message queues with [task queues](#task-queues).

## What the model leaves out

Real brokers add acknowledgements, retries, ordering guarantees, dead-letter queues and persistence to disk. The behaviour that matters for system design, rate mismatch and where to put the waiting, is what is shown here.
