// A message queue between a producer and some consumers, with an optional back-pressure rule.
// Rates are messages per tick and may be fractional.

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
  produced: number;
  consumed: number;
  dropped: number;
  throttled: number;     // messages the producer held back because of back pressure
  carry: { p: number; c: number }; // fractional leftovers so rates like 2.5 work
}

export const emptyQueue = (): QueueState => ({ tick: 0, depth: 0, produced: 0, consumed: 0, dropped: 0, throttled: 0, carry: { p: 0, c: 0 } });

/** Share of capacity above which back pressure starts to slow the producer. */
export const PRESSURE_AT = 0.8;

export function step(s: QueueState, p: QueueParams): QueueState {
  const out: QueueState = { ...s, carry: { ...s.carry }, tick: s.tick + 1 };
  const capacityPerTick = p.consumers * p.perConsumer;

  // Producer. With back pressure, once the queue is mostly full it may only send what the consumers can take.
  let want = p.produce;
  if (p.backPressure && s.depth >= PRESSURE_AT * p.capacity) {
    const allowed = Math.min(p.produce, capacityPerTick);
    out.throttled += p.produce - allowed;
    want = allowed;
  }
  out.carry.p += want;
  const send = Math.floor(out.carry.p);
  out.carry.p -= send;

  const room = Math.max(0, p.capacity - out.depth);
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
