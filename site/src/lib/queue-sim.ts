// A message queue between a producer and some consumers, with an optional back-pressure rule.
// Rates are messages per tick and may be fractional.
//
// Without back pressure, a message that does not fit in the queue is dropped.
// With back pressure, it is not dropped: it waits at the producer (its "backlog") and is sent later.
// Nothing is lost, but the waiting has moved upstream, to the producer and whoever is calling it.

export interface QueueParams {
  produce: number;       // what the producer would like to send per tick
  consumers: number;     // number of consumers
  perConsumer: number;   // messages one consumer handles per tick
  capacity: number;      // the queue can hold this many messages
  backPressure: boolean; // slow the producer down when the queue is nearly full
}

export interface QueueState {
  tick: number;
  depth: number;
  created: number;       // messages the producer has generated so far
  produced: number;      // messages accepted into the queue
  consumed: number;
  dropped: number;
  backlog: number;       // messages waiting at the producer because of back pressure
  throttled: number;     // messages that have had to wait at the producer at least once
  carry: { p: number; c: number }; // fractional leftovers so rates like 2.5 work
}

export const emptyQueue = (): QueueState => ({ tick: 0, depth: 0, created: 0, produced: 0, consumed: 0, dropped: 0, backlog: 0, throttled: 0, carry: { p: 0, c: 0 } });

/** Share of capacity above which back pressure starts to slow the producer. */
export const PRESSURE_AT = 0.8;

export function step(s: QueueState, p: QueueParams): QueueState {
  const out: QueueState = { ...s, carry: { ...s.carry }, tick: s.tick + 1 };
  const capacityPerTick = p.consumers * p.perConsumer;

  // New messages this tick. Anything already waiting at the producer goes first.
  out.carry.p += p.produce;
  const fresh = Math.floor(out.carry.p);
  out.carry.p -= fresh;
  out.created += fresh;
  const want = s.backlog + fresh;
  const room = Math.max(0, p.capacity - out.depth);

  let send = want;
  if (p.backPressure) {
    // Never overfill the queue, and once it is mostly full only send what the consumers can take.
    const limit = s.depth >= PRESSURE_AT * p.capacity ? Math.min(capacityPerTick, room) : room;
    send = Math.min(want, limit);
    out.backlog = want - send;
    const oldStillWaiting = Math.max(0, s.backlog - send);
    out.throttled += out.backlog - oldStillWaiting; // count each message once, the first time it has to wait
  }

  const accepted = Math.min(send, room);
  out.depth += accepted;
  out.produced += accepted;
  out.dropped += send - accepted;

  // Consumers.
  out.carry.c += capacityPerTick;
  const take = Math.min(Math.floor(out.carry.c), out.depth);
  out.carry.c -= Math.floor(out.carry.c);
  out.depth -= take;
  out.consumed += take;
  return out;
}

export function run(p: QueueParams, ticks: number): QueueState[] {
  const frames: QueueState[] = [emptyQueue()];
  for (let i = 0; i < ticks; i++) frames.push(step(frames[frames.length - 1], p));
  return frames;
}

/** How long a new message waits behind the ones already queued, in ticks. */
export function waitTicks(depth: number, p: QueueParams): number {
  const rate = p.consumers * p.perConsumer;
  return rate > 0 ? depth / rate : Infinity;
}

/** How long a new message waits in total: first at the producer behind its backlog, then in the queue. */
export function totalWaitTicks(s: QueueState, p: QueueParams): number {
  return waitTicks(s.backlog + s.depth, p);
}
