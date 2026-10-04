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


export type Algo = 'rr' | 'random' | 'least' | 'wrr' | 'hash';
export interface LbResult { served: number[]; mean: number; p50: number; p95: number; maxQueue: number; frames: number[][]; busy: number[] }

export function simulateLb(algo: Algo, speeds: number[], hotClient: boolean): LbResult {
  const rnd = mulberry32(21);
  const n = speeds.length;
  const totalSpeed = speeds.reduce((a, b) => a + b, 0);
  const TICKS = 160;
  const queues: { work: number; arrived: number }[][] = speeds.map(() => []);
  const served = speeds.map(() => 0);
  const lat: number[] = [];
  const frames: number[][] = [];
  const busy = speeds.map(() => 0);
  let rr = 0;
  const wrrCurrent = speeds.map(() => 0);
  const meanWork = 0.8 * 2 + 0.2 * 15; // 4.6 work units per request
  const rate = (0.72 * totalSpeed) / meanWork; // arrivals per tick targeting ~72% utilisation
  let maxQ = 0;

  for (let t = 0; t < TICKS; t++) {
    let arrivals = Math.floor(rate);
    if (rnd() < rate - arrivals) arrivals++;
    for (let a = 0; a < arrivals; a++) {
      const work = rnd() < 0.8 ? 1 + rnd() * 2 : 8 + rnd() * 14;
      const client = hotClient && rnd() < 0.35 ? 0 : 1 + Math.floor(rnd() * 24);
      let s = 0;
      if (algo === 'rr') { s = rr++ % n; }
      else if (algo === 'random') s = Math.floor(rnd() * n);
      else if (algo === 'least') { s = 0; for (let i = 1; i < n; i++) if (queues[i].length < queues[s].length) s = i; }
      else if (algo === 'wrr') { // smooth weighted round robin
        wrrCurrent.forEach((_, i) => (wrrCurrent[i] += speeds[i]));
        s = wrrCurrent.indexOf(Math.max(...wrrCurrent));
        wrrCurrent[s] -= totalSpeed;
      } else s = hash32(`client-${client}`) % n;
      queues[s].push({ work, arrived: t });
      served[s]++;
    }
    for (let i = 0; i < n; i++) {
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
    maxQ = Math.max(maxQ, ...queues.map((q) => q.length));
  }
  for (let i = 0; i < n; i++) for (const r of queues[i]) lat.push(TICKS - r.arrived + Math.ceil(r.work / speeds[i]));
  lat.sort((a, b) => a - b);
  const q = (p: number) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] ?? 0;
  return { served, mean: lat.reduce((a, b) => a + b, 0) / Math.max(1, lat.length), p50: q(0.5), p95: q(0.95), maxQueue: maxQ, frames, busy };
}

