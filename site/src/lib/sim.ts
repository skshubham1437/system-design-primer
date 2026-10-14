// Deterministic simulators used by the labs. Pure functions: no DOM, so they are unit tested.

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a followed by murmur3's finaliser, so similar strings land far apart.
export function hash32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}


export type Policy = 'lru' | 'lfu' | 'fifo' | 'random' | 'opt';
export interface Step { key: string; hit: boolean; evicted?: string; cache: string[] }

export function simulateCache(policy: Policy, seq: string[], cap: number): Step[] {
  const rnd = mulberry32(7);
  const steps: Step[] = [];
  let cache: string[] = []; // order depends on policy: LRU/FIFO keep oldest first
  const freq = new Map<string, number>();
  const last = new Map<string, number>();
  seq.forEach((key, t) => {
    const hit = cache.includes(key);
    let evicted: string | undefined;
    last.set(key, t);
    if (hit) {
      freq.set(key, (freq.get(key) ?? 0) + 1);
      if (policy === 'lru') cache = [...cache.filter((k) => k !== key), key];
    } else {
      if (cache.length >= cap) {
        let victim: string;
        if (policy === 'lru' || policy === 'fifo') victim = cache[0];
        else if (policy === 'lfu') victim = [...cache].sort((a, b) => (freq.get(a)! - freq.get(b)!) || (last.get(a)! - last.get(b)!))[0];
        else if (policy === 'random') victim = cache[Math.floor(rnd() * cache.length)];
        else {
          const next = (k: string) => { const i = seq.indexOf(k, t + 1); return i < 0 ? Infinity : i; };
          victim = [...cache].sort((a, b) => next(b) - next(a))[0];
        }
        evicted = victim;
        cache = cache.filter((k) => k !== victim);
        freq.delete(victim);
      }
      cache = [...cache, key];
      freq.set(key, 1);
    }
    steps.push({ key, hit, evicted, cache: [...cache] });
  });
  return steps;
}


export type Algo = 'rr' | 'random' | 'least' | 'p2c' | 'wrr' | 'hash';
export interface LbResult { served: number[]; mean: number; p50: number; p95: number; maxQueue: number; frames: number[][]; busy: number[]; failed: number }

export interface LbOptions {
  /** Server 1 stops working at this tick. It still accepts connections, so requests sent to it just wait. */
  failAt?: number;
  /** The balancer probes its servers and stops using one that fails, after `DETECT_TICKS`. */
  healthChecks?: boolean;
}

export const LB_TICKS = 160;
/** How long a health check takes to notice a dead server (a few missed probes). */
export const DETECT_TICKS = 6;

export function simulateLb(algo: Algo, speeds: number[], hotClient: boolean, seed = 21, opts: LbOptions = {}): LbResult {
  const rnd = mulberry32(seed);         // the traffic: identical for every algorithm with the same seed
  const pick = mulberry32(seed + 7919); // routing choices, kept separate so they never change the traffic
  const n = speeds.length;
  const totalSpeed = speeds.reduce((a, b) => a + b, 0);
  const queues: { work: number; arrived: number }[][] = speeds.map(() => []);
  const served = speeds.map(() => 0);
  const lat: number[] = [];
  const frames: number[][] = [];
  const busy = speeds.map(() => 0);
  let rr = 0;
  let failed = 0;
  const wrrCurrent = speeds.map(() => 0);
  const meanWork = 0.8 * 2 + 0.2 * 15; // 4.6 work units per request
  const rate = (0.72 * totalSpeed) / meanWork; // arrivals per tick targeting ~72% utilisation
  let maxQ = 0;
  const dead = (t: number) => opts.failAt !== undefined && t >= opts.failAt;
  const detected = (t: number) => !!opts.healthChecks && opts.failAt !== undefined && t >= opts.failAt + DETECT_TICKS;

  for (let t = 0; t < LB_TICKS; t++) {
    // The moment the health check notices, connections to the dead server are reset: those requests fail.
    if (opts.healthChecks && opts.failAt !== undefined && t === opts.failAt + DETECT_TICKS) { failed += queues[0].length; queues[0] = []; }
    const live = speeds.map((_, i) => i).filter((i) => !(i === 0 && detected(t))); // the servers the balancer will use
    const liveSpeed = live.reduce((a, i) => a + speeds[i], 0);

    let arrivals = Math.floor(rate);
    if (rnd() < rate - arrivals) arrivals++;
    for (let a = 0; a < arrivals; a++) {
      const work = rnd() < 0.8 ? 1 + rnd() * 2 : 8 + rnd() * 14;
      const client = hotClient && rnd() < 0.35 ? 0 : 1 + Math.floor(rnd() * 24);
      let s = live[0];
      if (algo === 'rr') { do { s = rr++ % n; } while (!live.includes(s)); }
      else if (algo === 'random') s = live[Math.floor(pick() * live.length)];
      else if (algo === 'least') { // fewest in flight; ties broken at random, as real balancers do
        const fewest = Math.min(...live.map((i) => queues[i].length));
        const tied = live.filter((i) => queues[i].length === fewest);
        s = tied[Math.floor(pick() * tied.length)];
      } else if (algo === 'p2c') { // power of two choices: sample two servers, use the less busy one
        const a1 = live[Math.floor(pick() * live.length)];
        let a2 = live[Math.floor(pick() * live.length)];
        if (live.length > 1) while (a2 === a1) a2 = live[Math.floor(pick() * live.length)];
        s = queues[a2].length < queues[a1].length ? a2 : a1;
      } else if (algo === 'wrr') { // smooth weighted round robin over the live servers
        for (const i of live) wrrCurrent[i] += speeds[i];
        s = live.reduce((best, i) => (wrrCurrent[i] > wrrCurrent[best] ? i : best), live[0]);
        wrrCurrent[s] -= liveSpeed;
      } else s = live[hash32(`client-${client}`) % live.length]; // when a server leaves, clients are rehashed
      queues[s].push({ work, arrived: t });
      served[s]++;
    }
    for (let i = 0; i < n; i++) {
      if (i === 0 && dead(t)) continue; // a dead server does no work
      let budget = speeds[i];
      if (queues[i].length) busy[i]++;
      while (budget > 0 && queues[i].length) {
        const head = queues[i][0];
        const use = Math.min(budget, head.work);
        head.work -= use; budget -= use;
        if (head.work <= 1e-9) { lat.push(t + 1 - head.arrived); queues[i].shift(); }
      }
    }
    frames.push(queues.map((q) => q.length));
    maxQ = Math.max(maxQ, ...queues.filter((_, i) => !(i === 0 && dead(t))).map((q) => q.length));
  }
  for (let i = 0; i < n; i++) {
    if (i === 0 && dead(LB_TICKS)) { failed += queues[i].length; continue; } // stuck on a dead server: they time out
    for (const r of queues[i]) lat.push(LB_TICKS - r.arrived + Math.ceil(r.work / speeds[i]));
  }
  lat.sort((a, b) => a - b);
  const q = (p: number) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] ?? 0;
  return { served, mean: lat.reduce((a, b) => a + b, 0) / Math.max(1, lat.length), p50: q(0.5), p95: q(0.95), maxQueue: maxQ, frames, busy, failed };
}


export interface LbSummary { mean: number; p95: number; p95Low: number; p95High: number; maxQueue: number; failed: number; runs: number }

/** One run proves little. Repeat the simulation over several traffic seeds and report the median and the spread. */
export function summarizeLb(algo: Algo, speeds: number[], hotClient: boolean, opts: LbOptions = {}, runs = 20): LbSummary {
  const rs = Array.from({ length: runs }, (_, i) => simulateLb(algo, speeds, hotClient, 21 + i * 101, opts));
  const med = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
  const p95s = rs.map((r) => r.p95);
  return { mean: med(rs.map((r) => r.mean)), p95: med(p95s), p95Low: Math.min(...p95s), p95High: Math.max(...p95s), maxQueue: med(rs.map((r) => r.maxQueue)), failed: med(rs.map((r) => r.failed)), runs };
}
