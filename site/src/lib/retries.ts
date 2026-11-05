// Idempotent retries: pure models of one payment under failure, and of many clients retrying at once.
//
// runPayment plays one charge through a client, a server and a database, with one fault on the first attempt.
// Every fault looks the same to the client (a timeout), so what a retry does depends on what had already happened.
//
// retryStorm plays many clients that all fail at the same moment, against a server that comes back after an outage
// with a fixed capacity. One tick is one second.

import { mulberry32 } from './sim';

/* ------------------------------------------------------------ one payment */

export type Fault = 'none' | 'request-lost' | 'crash-before-commit' | 'crash-after-commit' | 'reply-lost' | 'slow-reply';
export const FAULTS: Fault[] = ['none', 'request-lost', 'crash-before-commit', 'crash-after-commit', 'reply-lost', 'slow-reply'];

export type Policy = 'no-retry' | 'retry' | 'retry-key';
export const POLICIES: Policy[] = ['no-retry', 'retry', 'retry-key'];

/** Ways of getting the key wrong. Only 'retry-key' uses one.
 *   new-key     the client makes a fresh key for each attempt
 *   not-atomic  the server saves the key in a separate step after the charge, and has no in-progress marker
 *   expired     the retry arrives after the server has deleted the key
 */
export type Mistake = 'none' | 'new-key' | 'not-atomic' | 'expired';
export const MISTAKES: Mistake[] = ['none', 'new-key', 'not-atomic', 'expired'];

export type Who = 'client' | 'network' | 'server' | 'db';
export interface Step {
  who: Who;
  text: string;
  tone?: 'ok' | 'bad';
  /** Charges made so far, once this step has happened. */
  charges: number;
}

export interface Outcome {
  fault: Fault;
  policy: Policy;
  mistake: Mistake;
  steps: Step[];
  charges: number;
  attempts: number;
  /** What the client ends up believing. A timeout it did not retry leaves it not knowing. */
  client: 'paid' | 'unknown';
}

export type Grade = 'right' | 'unknown' | 'lost' | 'double';

/** right: charged once and the client knows. unknown: charged once, client unsure. lost: not charged. double: charged twice. */
export function grade(o: Pick<Outcome, 'charges' | 'client'>): Grade {
  if (o.charges > 1) return 'double';
  if (o.charges === 0) return 'lost';
  return o.client === 'paid' ? 'right' : 'unknown';
}

export function runPayment(fault: Fault, policy: Policy, mistake: Mistake = 'none'): Outcome {
  const useKey = policy === 'retry-key';
  const bad: Mistake = useKey ? mistake : 'none';
  const steps: Step[] = [];
  let charges = 0;
  let attempts = 0;
  const saved = new Set<string>();
  const say = (who: Who, text: string, tone?: 'ok' | 'bad') => steps.push({ who, text, tone, charges });

  const keyFor = (attempt: number) => (bad === 'new-key' ? `key-${attempt}` : 'key-1');
  const send = () => {
    attempts++;
    const key = useKey ? keyFor(attempts) : null;
    say('client', `Attempt ${attempts}: POST /charges${key ? `, Idempotency-Key: ${key}` : ', no key'}`);
    return key;
  };
  const charge = (key: string | null) => {
    charges++;
    // done right, the key is saved in the same transaction as the charge, so neither can exist without the other
    if (key && bad !== 'not-atomic') {
      saved.add(key);
      say('db', `One transaction: charge the card and save ${key} with the response`, 'ok');
    } else say('db', 'Commit: charge the card');
  };
  const saveAfter = (key: string | null) => {
    if (key && bad === 'not-atomic') { saved.add(key); say('db', `Separate step: save ${key}`); }
  };

  /** A healthy attempt: replay if the key is known, otherwise do the work. */
  const finish = (): Outcome => {
    const key = send();
    if (key && saved.has(key)) say('server', `Already seen ${key}: return the saved response, no new charge`, 'ok');
    else {
      if (key) say('server', `${key} is new: run the charge`);
      charge(key);
      saveAfter(key);
    }
    say('client', 'Reply arrives: 200 OK', 'ok');
    return { fault, policy, mistake: bad, steps, charges, attempts, client: 'paid' };
  };

  const timedOut = () => say('client', 'No reply before the timeout. The client cannot tell what happened.', 'bad');
  const giveUp = (): Outcome => {
    say('client', 'No retry: the client reports an unknown result', 'bad');
    return { fault, policy, mistake: bad, steps, charges, attempts, client: 'unknown' };
  };
  const expire = () => {
    if (bad === 'expired') { saved.clear(); say('server', 'Time passes: the server deletes the key after its retention period'); }
  };

  if (fault === 'none') return finish();

  const key = send();
  if (fault === 'slow-reply') {
    say('server', 'Starts the charge, but this one is slow');
    timedOut();
    if (policy === 'no-retry') {
      charge(null);
      say('network', 'The reply arrives after the client stopped listening', 'bad');
      return giveUp();
    }
    if (bad === 'expired') {
      charge(key);
      say('network', 'The reply arrives after the client stopped listening', 'bad');
      expire();
      return finish();
    }
    if (useKey && bad === 'none') {
      const again = send();
      say('server', `${again} is still in progress: 409 Conflict, try again shortly`, 'ok');
      charge(key);
      return finish();
    }
    // no key, a new key, or a key saved only afterwards: nothing tells the server this is the same payment
    const second = send();
    say('server', second ? `${second} not saved yet: run the charge again` : 'Looks like a new payment: run the charge', 'bad');
    charge(second);
    saveAfter(second);
    say('client', 'Reply to attempt 2 arrives: 200 OK', 'ok');
    charge(key);
    saveAfter(key);
    say('network', 'The first attempt finishes too and charges again. Its reply goes nowhere.', 'bad');
    return { fault, policy, mistake: bad, steps, charges, attempts, client: 'paid' };
  }

  if (fault === 'request-lost') say('network', 'The request is lost on the way. The server never sees it.', 'bad');
  else if (fault === 'crash-before-commit') {
    say('server', 'Receives the request and crashes before committing', 'bad');
    say('db', 'The open transaction rolls back: no charge, no key');
  } else if (fault === 'crash-after-commit') {
    charge(key);
    say('server', `Crashes after the commit, before ${bad === 'not-atomic' ? 'saving the key or ' : ''}replying`, 'bad');
  } else {
    charge(key);
    saveAfter(key);
    say('network', 'The server replies, but the reply is lost on the way back', 'bad');
  }
  timedOut();
  if (policy === 'no-retry') return giveUp();
  expire();
  return finish();
}

/* ------------------------------------------------------------ many clients */

export type Backoff = 'no-retry' | 'immediate' | 'exponential' | 'full-jitter';
export const BACKOFFS: Backoff[] = ['no-retry', 'immediate', 'exponential', 'full-jitter'];

export interface StormParams {
  clients: number;
  /** Requests the server can answer per tick once it is back. */
  capacity: number;
  /** The server fails everything before this tick. */
  outage: number;
  /** Attempts per client, counting the first. */
  maxAttempts: number;
  baseTicks: number;
  capTicks: number;
  seed?: number;
}

export interface StormResult {
  /** Requests that arrived in each tick. */
  offered: number[];
  /** Requests answered in each tick. */
  served: number[];
  attempts: number;
  /** The most requests in any one tick after the server came back. */
  peakAfter: number;
  succeeded: number;
  gaveUp: number;
  /** The tick of the last attempt. */
  finishedAt: number;
}

/** The longest wait before retry number `retry` (0 for the first retry): base * 2^retry, up to the cap. */
export const backoffCeiling = (retry: number, baseTicks: number, capTicks: number) => Math.min(capTicks, baseTicks * 2 ** retry);

export function retryStorm(policy: Backoff, p: StormParams): StormResult {
  const rand = mulberry32(p.seed ?? 42);
  const buckets = new Map<number, number[]>();
  const add = (t: number, c: number) => { const b = buckets.get(t); if (b) b.push(c); else buckets.set(t, [c]); };
  const tries = new Array<number>(p.clients).fill(0);
  for (let c = 0; c < p.clients; c++) add(0, c);

  const offered: number[] = [];
  const served: number[] = [];
  let attempts = 0;
  let succeeded = 0;
  let gaveUp = 0;
  let finishedAt = 0;
  for (let t = 0; buckets.size > 0; t++) {
    const arrivals = buckets.get(t) ?? [];
    buckets.delete(t);
    const room = t < p.outage ? 0 : p.capacity;
    const ok = Math.min(room, arrivals.length);
    offered[t] = arrivals.length;
    served[t] = ok;
    attempts += arrivals.length;
    succeeded += ok;
    if (arrivals.length) finishedAt = t;
    for (const c of arrivals.slice(ok)) {
      const retry = tries[c]++;
      if (policy === 'no-retry' || tries[c] >= p.maxAttempts) { gaveUp++; continue; }
      const ceiling = backoffCeiling(retry, p.baseTicks, p.capTicks);
      const delay = policy === 'immediate' ? 1 : policy === 'exponential' ? ceiling : Math.max(1, Math.ceil(rand() * ceiling));
      add(t + delay, c);
    }
  }
  const peakAfter = Math.max(0, ...offered.slice(p.outage).map((n) => n ?? 0));
  return { offered: Array.from(offered, (n) => n ?? 0), served: Array.from(served, (n) => n ?? 0), attempts, peakAfter, succeeded, gaveUp, finishedAt };
}

/**
 * Retrying at every layer multiplies: a single call can become attempts^layers at the bottom.
 * The Google SRE book's example is 4 attempts at 3 layers, or 64. The Amazon Builders' Library example is 3 at 5, or 243.
 */
export const amplification = (attemptsPerLayer: number, layers: number) => attemptsPerLayer ** layers;
