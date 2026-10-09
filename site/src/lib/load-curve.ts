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
