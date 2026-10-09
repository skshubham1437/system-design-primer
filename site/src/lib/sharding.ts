// How different sharding strategies spread users and traffic. Deterministic, so the picture is repeatable.
import { hash32, mulberry32 } from './sim';

export interface User { id: number; name: string; initial: string; city: string; weight: number }
export type Strategy = 'range' | 'hash' | 'directory';
export type Query = 'by-key' | 'name-prefix' | 'by-city';

// A realistic-ish surname spread: some initials are far more common than others.
const SURNAMES: [string, number][] = [
  ['Smith', 9], ['Sanchez', 3], ['Singh', 4], ['Shah', 2], ['Stone', 2], ['Johnson', 6], ['Jones', 5], ['Jackson', 3],
  ['Miller', 6], ['Martin', 4], ['Moore', 3], ['Murphy', 2], ['Brown', 6], ['Baker', 2], ['Davis', 5], ['Garcia', 4],
  ['Wilson', 4], ['Williams', 6], ['Taylor', 4], ['Anderson', 4], ['Thomas', 3], ['Clark', 3], ['Lee', 4], ['Lopez', 2],
  ['Walker', 2], ['Hall', 2], ['Allen', 2], ['Young', 2], ['King', 2], ['Wright', 2], ['Nguyen', 3], ['Patel', 4],
  ['Rivera', 2], ['Evans', 1], ['Kim', 3], ['Zhang', 2], ['Xu', 1], ['Quinn', 1], ['Ortiz', 1], ['Vega', 1], ['Yamada', 1], ['Ueda', 1],
];
export const CITIES = ['Lagos', 'Lima', 'Oslo', 'Pune', 'Reno', 'Seoul'];

export function makeUsers(count = 600, powerUsers = true, seed = 3): User[] {
  const rnd = mulberry32(seed);
  const total = SURNAMES.reduce((n, [, w]) => n + w, 0);
  return Array.from({ length: count }, (_, id) => {
    let x = rnd() * total;
    let name = SURNAMES[0][0];
    for (const [s, w] of SURNAMES) { x -= w; if (x <= 0) { name = s; break; } }
    const power = powerUsers && id % 20 === 3; // 5% of users generate a big share of the traffic
    return { id, name, initial: name[0], city: CITIES[Math.floor(rnd() * CITIES.length)], weight: power ? 14 : 1 };
  });
}

/** Shard index (0..shards-1) for every user. */
export function assign(strategy: Strategy, users: User[], shards: number): number[] {
  if (strategy === 'range') {
    const per = Math.ceil(26 / shards); // contiguous slices of the alphabet
    return users.map((u) => Math.min(shards - 1, Math.floor((u.initial.charCodeAt(0) - 65) / per)));
  }
  if (strategy === 'hash') return users.map((u) => hash32(`user-${u.id}`) % shards);
  // directory: a lookup table that places the heaviest users first on the least loaded shard
  const load = new Array(shards).fill(0);
  const out = new Array(users.length).fill(0);
  for (const u of [...users].sort((a, b) => b.weight - a.weight || a.id - b.id)) {
    const s = load.indexOf(Math.min(...load));
    out[u.id] = s;
    load[s] += u.weight;
  }
  return out;
}

export function load(users: User[], assignment: number[], shards: number) {
  const count: number[] = new Array(shards).fill(0);
  const traffic: number[] = new Array(shards).fill(0);
  users.forEach((u, i) => { count[assignment[i]]++; traffic[assignment[i]] += u.weight; });
  return { count, traffic };
}

/** How much busier the busiest shard is than an even split would make it (1 = perfectly even). */
export function imbalance(traffic: number[]): number {
  const mean = traffic.reduce((a, b) => a + b, 0) / traffic.length;
  return mean ? Math.max(...traffic) / mean : 1;
}

/** How many shards a query has to ask. Fewer is cheaper; "all" means scatter-gather. */
export function shardsTouched(query: Query, strategy: Strategy, shards: number): number {
  if (query === 'by-key') return 1;                                      // the shard key itself is routable
  if (query === 'name-prefix') return strategy === 'range' ? 1 : shards; // only range sharding keeps neighbours together
  return shards;                                                         // a city can be on any shard
}
