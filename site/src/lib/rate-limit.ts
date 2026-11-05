// Rate limiting: the same requests through five limiters, so their differences can be seen and tested.
// Times are in milliseconds. A limit of L requests per window of W ms is the target for every algorithm.
//
//   fixed-window     count requests per calendar window; the count resets at each boundary
//   sliding-log      keep the time of every allowed request; allow if fewer than L in the last W ms
//   sliding-counter  weight the previous window's count by how much of it still overlaps the last W ms
//   token-bucket     a bucket of `burst` tokens refills at L per W; each request spends one
//   leaky-bucket     a queue of `burst` places drains at a steady L per W; requests wait their turn
//
// The first four answer at once (allowed or rejected). The leaky bucket instead delays requests and only
// rejects when its queue is full, so its output is perfectly smooth but its callers wait.

import { mulberry32 } from './sim';

export type Algorithm = 'fixed-window' | 'sliding-log' | 'sliding-counter' | 'token-bucket' | 'leaky-bucket';
export const ALGORITHMS: Algorithm[] = ['fixed-window', 'sliding-log', 'sliding-counter', 'token-bucket', 'leaky-bucket'];

export interface LimitParams {
  limit: number;    // requests allowed per window
  windowMs: number; // the window
  burst: number;    // token bucket size, or leaky bucket queue length
}

export interface Decision {
  t: number;        // when the request arrived
  allowed: boolean;
  startMs: number;  // when it is served: t, or later for a request the leaky bucket queued
}

/** Run every request (arrival times, in order) through one limiter. */
export function limitRequests(arrivals: number[], algo: Algorithm, p: LimitParams): Decision[] {
  const out: Decision[] = [];
  const L = p.limit;
  const W = p.windowMs;
  if (algo === 'fixed-window') {
    let win = -1;
    let count = 0;
    for (const t of arrivals) {
      const w = Math.floor(t / W);
      if (w !== win) { win = w; count = 0; }
      const allowed = count < L;
      if (allowed) count++;
      out.push({ t, allowed, startMs: t });
    }
  } else if (algo === 'sliding-log') {
    const log: number[] = [];
    for (const t of arrivals) {
      while (log.length && log[0] <= t - W) log.shift();
      const allowed = log.length < L;
      if (allowed) log.push(t);
      out.push({ t, allowed, startMs: t });
    }
  } else if (algo === 'sliding-counter') {
    const counts = new Map<number, number>();
    for (const t of arrivals) {
      const w = Math.floor(t / W);
      const elapsed = (t - w * W) / W;
      const estimate = (counts.get(w - 1) ?? 0) * (1 - elapsed) + (counts.get(w) ?? 0);
      const allowed = estimate < L;
      if (allowed) counts.set(w, (counts.get(w) ?? 0) + 1);
      out.push({ t, allowed, startMs: t });
    }
  } else if (algo === 'token-bucket') {
    const perMs = L / W;
    let tokens = p.burst;
    let last = arrivals[0] ?? 0;
    for (const t of arrivals) {
      tokens = Math.min(p.burst, tokens + (t - last) * perMs);
      last = t;
      const allowed = tokens >= 1;
      if (allowed) tokens -= 1;
      out.push({ t, allowed, startMs: t });
    }
  } else {
    // leaky bucket as a queue: one request leaves every W / L ms; at most `burst` wait at a time
    const interval = W / L;
    const queued: number[] = []; // start times of requests not yet served
    let lastStart = -Infinity;
    for (const t of arrivals) {
      while (queued.length && queued[0] <= t) queued.shift();
      if (queued.length >= p.burst) { out.push({ t, allowed: false, startMs: t }); continue; }
      const startMs = Math.max(t, lastStart + interval);
      lastStart = startMs;
      queued.push(startMs);
      out.push({ t, allowed: true, startMs });
    }
  }
  return out;
}

export interface Summary {
  sent: number;
  allowed: number;
  rejected: number;
  /** The most requests served in any span of one window. Above the limit means the limiter let a burst through. */
  peakInWindow: number;
  /** When that busiest span started. */
  peakAt: number;
  /** The longest a request waited before being served (only the leaky bucket makes requests wait). */
  maxWaitMs: number;
}

export function summarize(decisions: Decision[], windowMs: number): Summary {
  const served = decisions.filter((d) => d.allowed).map((d) => d.startMs).sort((a, b) => a - b);
  let peak = 0;
  let peakAt = 0;
  for (let i = 0, j = 0; i < served.length; i++) {
    while (served[i] - served[j] >= windowMs) j++;
    if (i - j + 1 > peak) { peak = i - j + 1; peakAt = served[j]; }
  }
  return {
    sent: decisions.length,
    allowed: served.length,
    rejected: decisions.length - served.length,
    peakInWindow: peak,
    peakAt,
    maxWaitMs: Math.max(0, ...decisions.map((d) => d.startMs - d.t)),
  };
}

/* ------------------------------------------------------------ traffic */

export type Pattern = 'steady' | 'boundary' | 'bursts' | 'random';
export const PATTERNS: Pattern[] = ['steady', 'boundary', 'bursts', 'random'];

/**
 * Arrival times over `durationMs` for a limit of `limit` per `windowMs`.
 *   steady    evenly spaced at one and a half times the limit
 *   boundary  a full window's worth just before a window boundary and another just after it, every other window
 *   bursts    quiet, then twice the limit at once, every third window
 *   random    random arrivals averaging the limit, so some windows are over it and some under
 */
export function traffic(pattern: Pattern, limit: number, windowMs: number, durationMs: number, seed = 7): number[] {
  const out: number[] = [];
  if (pattern === 'steady') {
    const gap = windowMs / (limit * 1.5);
    for (let t = 0; t < durationMs; t += gap) out.push(Math.round(t));
  } else if (pattern === 'boundary') {
    const spread = windowMs / 10; // each burst arrives within the last or first tenth of a window
    for (let b = windowMs; b < durationMs; b += 2 * windowMs) {
      for (let i = 0; i < limit; i++) out.push(Math.round(b - spread + (i * spread) / limit));
      for (let i = 0; i < limit; i++) out.push(Math.round(b + (i * spread) / limit));
    }
  } else if (pattern === 'bursts') {
    for (let b = windowMs / 2; b < durationMs; b += 3 * windowMs) {
      for (let i = 0; i < 2 * limit; i++) out.push(Math.round(b + i * 5));
    }
  } else {
    const rand = mulberry32(seed);
    const mean = windowMs / limit;
    for (let t = -mean * Math.log(1 - rand()); t < durationMs; t += -mean * Math.log(1 - rand())) out.push(Math.round(t));
  }
  return out.filter((t) => t >= 0 && t < durationMs).sort((a, b) => a - b);
}
