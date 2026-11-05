// Why latency explodes as a system approaches full utilisation (M/M/1 queue: one server, random arrivals).
// Mean time in the system = service time / (1 - utilisation).

export const MAX_UTILISATION = 0.99;

export function responseMs(utilisation: number, serviceMs: number): number {
  const u = Math.min(Math.max(utilisation, 0), MAX_UTILISATION);
  return serviceMs / (1 - u);
}

/** Requests per second actually completed. Beyond capacity, extra load just queues (or is dropped). */
export function throughput(utilisation: number, capacityPerSec: number): number {
  return Math.min(Math.max(utilisation, 0), 1) * capacityPerSec;
}

/** How many identical servers keep each at or below `target` utilisation for a given arrival rate. */
export function serversFor(arrivalsPerSec: number, perServerPerSec: number, target = 0.7): number {
  return Math.max(1, Math.ceil(arrivalsPerSec / (perServerPerSec * target)));
}

export function curve(serviceMs: number, points = 60): { u: number; ms: number }[] {
  return Array.from({ length: points + 1 }, (_, i) => { const u = (i / points) * MAX_UTILISATION; return { u, ms: responseMs(u, serviceMs) }; });
}

/**
 * One queue shared by c identical servers (M/M/c): any free server takes the next request.
 * Mean time in the system = S + C(c, a) × S / (c × (1 − ρ)), where C is the Erlang C probability of having to wait.
 */
export function responseMsShared(utilisation: number, servers: number, serviceMs: number): number {
  const rho = Math.min(Math.max(utilisation, 0), MAX_UTILISATION);
  const c = Math.max(1, Math.round(servers));
  const a = c * rho; // offered load in "servers' worth" of work
  let term = 1, sum = 1; // a^k / k!, summed for k = 0 … c−1
  for (let k = 1; k < c; k++) { term *= a / k; sum += term; }
  const top = (term * a / c) / (1 - rho); // a^c / c! × 1 / (1 − ρ)
  const erlangC = top / (sum + top);
  return serviceMs + (erlangC * serviceMs) / (c * (1 - rho));
}
