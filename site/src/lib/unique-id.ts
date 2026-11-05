// Unique IDs: the same requests through five ways of making an ID, under the failures that tell them apart.
//
//   auto-increment  one database counter; every ID is a round trip
//   ticket-servers  two database counters, one issuing odd numbers and one even
//   uuid-v4         122 random bits (RFC 9562 section 5.4)
//   uuid-v7         a 48-bit millisecond timestamp, then 74 random bits (RFC 9562 section 5.7)
//   snowflake       41 bits of milliseconds, 10 of machine id, 12 of sequence, as in Twitter's README
//
// Four app servers each ask for one ID per millisecond. Time is exact and clocks do what the scenario says.
// The IDs are real values in the real layouts, so duplicates and ordering come from comparing them, not from a rule.

import { mulberry32 } from './sim';

export type Scheme = 'auto-increment' | 'ticket-servers' | 'uuid-v4' | 'uuid-v7' | 'snowflake';
export const SCHEMES: Scheme[] = ['auto-increment', 'ticket-servers', 'uuid-v4', 'uuid-v7', 'snowflake'];

export type Scenario = 'normal' | 'clock-back' | 'clock-skew' | 'db-down' | 'stale-failover' | 'shared-worker' | 'burst';
export const SCENARIOS: Scenario[] = ['normal', 'clock-back', 'clock-skew', 'db-down', 'stale-failover', 'shared-worker', 'burst'];

export const SERVERS = 4;
export const DURATION_MS = 750;
export const BITS: Record<Scheme, number> = { 'auto-increment': 64, 'ticket-servers': 64, 'uuid-v4': 128, 'uuid-v7': 128, snowflake: 64 };

/** Scenario settings, in one place so the tests and the page can name them. */
export const SETTINGS = {
  clockBackAt: 300, clockBackMs: 50, clockBackServer: 1,
  skewMs: 40, skewServer: 3,
  downFrom: 200, downTo: 400,
  failoverAt: 400, failoverBehind: 100,
  burstAt: 300, burstSize: 5000, burstServer: 0,
};

const SEQUENCE_MAX = 4095; // 12 bits
const TIME_SHIFT = 22n;    // 10 machine bits + 12 sequence bits
const WORKER_SHIFT = 12n;
const UNIX_BASE_MS = 1_780_000_000_000; // an arbitrary "now" for the UUIDv7 timestamp
const CUSTOM_EPOCH_AGE_MS = 60_000_000_000; // the Snowflake clock counts from a custom epoch, about two years before "now"

export interface Issued {
  /** When the request arrived. */
  t: number;
  server: number;
  /** null when the request got no ID because the database was down. */
  id: bigint | null;
  /** How long the request waited for its ID. */
  waitMs: number;
}

export interface Options {
  /** Snowflake only: refuse to issue while the clock is behind the last time used. On by default, as in Twitter's README. */
  clockGuard?: boolean;
  seed?: number;
}

/** Requests in arrival order. Within a millisecond the servers come in a random order, as they would in life. */
export function arrivals(scenario: Scenario, seed = 11): { t: number; server: number }[] {
  const rand = mulberry32(seed);
  const out: { t: number; server: number }[] = [];
  for (let t = 0; t < DURATION_MS; t++) {
    const order = Array.from({ length: SERVERS }, (_, s) => s);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (scenario === 'burst' && t === SETTINGS.burstAt) for (let n = 0; n < SETTINGS.burstSize; n++) out.push({ t, server: SETTINGS.burstServer });
    for (const server of order) out.push({ t, server });
  }
  return out;
}

const clockOf = (scenario: Scenario, server: number, t: number) => {
  if (scenario === 'clock-back' && server === SETTINGS.clockBackServer && t >= SETTINGS.clockBackAt) return t - SETTINGS.clockBackMs;
  if (scenario === 'clock-skew' && server === SETTINGS.skewServer) return t + SETTINGS.skewMs;
  return t;
};

const random128 = (rand: () => number) => {
  let v = 0n;
  for (let i = 0; i < 4; i++) v = (v << 32n) | BigInt(Math.floor(rand() * 2 ** 32));
  return v;
};

/** The version and variant bits of RFC 9562 written over a 128-bit value. */
const stamp = (v: bigint, version: bigint) => {
  const ver = (v & ~(0xfn << 76n)) | (version << 76n);
  return (ver & ~(0x3n << 62n)) | (0x2n << 62n);
};

export function makeSnowflake(timeMs: number, worker: number, sequence: number): bigint {
  return (BigInt(timeMs) << TIME_SHIFT) | (BigInt(worker) << WORKER_SHIFT) | BigInt(sequence);
}

export function readSnowflake(id: bigint) {
  return { timeMs: Number(id >> TIME_SHIFT), worker: Number((id >> WORKER_SHIFT) & 0x3ffn), sequence: Number(id & 0xfffn) };
}

export function generate(scheme: Scheme, scenario: Scenario, o: Options = {}): Issued[] {
  const rand = mulberry32((o.seed ?? 11) + 1);
  const guard = o.clockGuard !== false;
  const down = (t: number) => scenario === 'db-down' && t >= SETTINGS.downFrom && t < SETTINGS.downTo;
  const out: Issued[] = [];

  let counter = 0;
  const tickets = [0, 0]; // how many each ticket server has issued: server 0 gives odd numbers, server 1 even
  let turn = 0;
  let failedOver = false;
  const flakes = Array.from({ length: SERVERS }, () => ({ last: -Infinity, seq: 0, peak: -Infinity })); // peak: the highest clock reading so far

  for (const { t, server } of arrivals(scenario, o.seed)) {
    if (scenario === 'stale-failover' && !failedOver && t >= SETTINGS.failoverAt) {
      failedOver = true;
      counter -= SETTINGS.failoverBehind;
      tickets[0] -= SETTINGS.failoverBehind;
    }
    if (scheme === 'auto-increment') {
      if (down(t)) { out.push({ t, server, id: null, waitMs: 0 }); continue; }
      out.push({ t, server, id: BigInt(++counter), waitMs: 0 });
    } else if (scheme === 'ticket-servers') {
      // the odd server is the one that goes down; the even one takes all the traffic meanwhile
      const pick = down(t) ? 1 : turn++ % 2;
      const n = ++tickets[pick];
      out.push({ t, server, id: BigInt(pick === 0 ? 2 * n - 1 : 2 * n), waitMs: 0 });
    } else if (scheme === 'uuid-v4') {
      out.push({ t, server, id: stamp(random128(rand), 4n), waitMs: 0 });
    } else if (scheme === 'uuid-v7') {
      const now = BigInt(UNIX_BASE_MS + clockOf(scenario, server, t));
      const low = random128(rand) & ((1n << 80n) - 1n);
      out.push({ t, server, id: stamp((now << 80n) | low, 7n), waitMs: 0 });
    } else {
      const f = flakes[server];
      const now = clockOf(scenario, server, t) + CUSTOM_EPOCH_AGE_MS;
      let time = now;
      if (now < f.peak) {
        if (guard) time = f.peak + 1; // the clock went backwards: hold requests until it passes the last time used
        else { f.last = -Infinity; f.peak = now; } // no guard: carry on from the earlier time, reusing values
      }
      time = Math.max(time, f.last);
      if (time === f.last) {
        f.seq++;
        if (f.seq > SEQUENCE_MAX) { time++; f.seq = 0; } // sequence used up: wait for the next millisecond
      } else f.seq = 0;
      f.last = time;
      f.peak = Math.max(f.peak, now);
      const worker = scenario === 'shared-worker' && server === 3 ? 2 : server;
      out.push({ t, server, id: makeSnowflake(time, worker, f.seq), waitMs: Math.max(0, time - now) });
    }
  }
  return out;
}

export interface IdSummary {
  requests: number;
  issued: number;
  failed: number;
  duplicates: number;
  /** IDs lower than one issued before them. */
  outOfOrder: number;
  /** The largest gap, in ms, between an ID and an earlier-issued ID that sorts after it. 0 means only within one millisecond. */
  worstGapMs: number;
  maxWaitMs: number;
  /** Trips to a database just to get an ID. */
  dbCalls: number;
}

export function summarizeIds(scheme: Scheme, issued: Issued[]): IdSummary {
  const got = issued.filter((r): r is Issued & { id: bigint } => r.id !== null);
  let top = -1n;
  let outOfOrder = 0;
  for (const r of got) { if (r.id < top) outOfOrder++; else top = r.id; }

  const sorted = [...got].sort((a, b) => (a.id > b.id ? -1 : a.id < b.id ? 1 : 0));
  let duplicates = 0;
  let worstGapMs = 0;
  let earliest = Infinity; // the earliest issue time among IDs strictly higher than the current one
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j < sorted.length && sorted[j].id === sorted[i].id) j++;
    duplicates += j - i - 1;
    for (let k = i; k < j; k++) worstGapMs = Math.max(worstGapMs, sorted[k].t + sorted[k].waitMs - earliest);
    for (let k = i; k < j; k++) earliest = Math.min(earliest, sorted[k].t + sorted[k].waitMs);
    i = j;
  }
  return {
    requests: issued.length,
    issued: got.length,
    failed: issued.length - got.length,
    duplicates,
    outOfOrder,
    worstGapMs,
    maxWaitMs: Math.max(0, ...issued.map((r) => r.waitMs)),
    dbCalls: scheme === 'auto-increment' || scheme === 'ticket-servers' ? issued.length : 0,
  };
}

export interface Point { x: number; y: number; dup: boolean; failed: boolean }

/** Up to `max` requests as points: x is the order issued, y the ID's rank among all IDs, both from 0 to 1. */
export function orderPoints(issued: Issued[], max = 300): Point[] {
  const ids = issued.flatMap((r) => (r.id === null ? [] : [r.id])).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const rank = new Map<bigint, number>();
  const seen = new Map<bigint, number>();
  ids.forEach((v, i) => { if (!rank.has(v)) rank.set(v, i); seen.set(v, (seen.get(v) ?? 0) + 1); });
  const step = Math.max(1, issued.length / max);
  const out: Point[] = [];
  const last = Math.max(1, ids.length - 1);
  // always keep the points that show a failure, which even sampling could miss
  for (let i = 0; i < issued.length; i++) {
    const r = issued[i];
    const dup = r.id !== null && (seen.get(r.id) ?? 0) > 1;
    const picked = Math.floor(i / step) !== Math.floor((i - 1) / step);
    if (!picked && !(dup && i % 4 === 0)) continue;
    out.push({ x: i / Math.max(1, issued.length - 1), y: r.id === null ? 0 : (rank.get(r.id) ?? 0) / last, dup, failed: r.id === null });
  }
  return out;
}

export function formatId(scheme: Scheme, id: bigint | null): string {
  if (id === null) return 'none: the database is down';
  if (scheme === 'uuid-v4' || scheme === 'uuid-v7') {
    const h = id.toString(16).padStart(32, '0');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  return id.toString();
}

/* ------------------------------------------------------------ random IDs and the birthday bound */

/** The chance of at least one duplicate among n random values from a space of the given size. */
export const collisionChance = (n: number, space: number) => -Math.expm1(-(n * (n - 1)) / (2 * space));

/** How many random values give this chance of a duplicate. About 1.18 times the square root of the space, for one half. */
export const idsForChance = (space: number, chance = 0.5) => Math.sqrt(2 * space * Math.log(1 / (1 - chance)));

/** How many pairs of n random values are expected to match. */
export const expectedDuplicates = (n: number, space: number) => (n * (n - 1)) / (2 * space);

/** Really draw n random values from the space. Returns how many duplicates turned up, and how early the first was. */
export function drawIds(n: number, space: number, seed = 1): { duplicates: number; firstAt: number | null } {
  const rand = mulberry32(seed);
  const seen = new Set<number>();
  let duplicates = 0;
  let firstAt: number | null = null;
  for (let i = 0; i < n; i++) {
    const v = Math.floor(((rand() * 2 ** 26 + rand()) / 2 ** 26) * space); // two draws, for spaces larger than 32 bits
    if (seen.has(v)) { duplicates++; firstAt ??= i + 1; } else seen.add(v);
  }
  return { duplicates, firstAt };
}

/** How many of `trials` separate draws found at least one duplicate. */
export function collisionTrials(n: number, space: number, trials: number, seed = 1): number {
  let hits = 0;
  for (let k = 0; k < trials; k++) if (drawIds(n, space, seed + k * 7919).duplicates > 0) hits++;
  return hits;
}
