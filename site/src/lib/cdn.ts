// A content delivery network with three edge locations and one origin. Times are milliseconds.

export type Region = 'us' | 'eu' | 'asia';
export type CdnMode = 'none' | 'pull' | 'push';

export const REGIONS: Region[] = ['us', 'eu', 'asia'];
/** Round trip from a user in each region to the origin, which sits in the US. */
export const ORIGIN_MS: Record<Region, number> = { us: 40, eu: 120, asia: 190 };
export const EDGE_MS = 15;

/** `edges[region]` is the time the edge cached the file, or null if it has no copy. */
export interface CdnState { mode: CdnMode; ttl: number; now: number; edges: Record<Region, number | null> }

export function create(mode: CdnMode, ttl = 5): CdnState {
  const published = mode === 'push' ? 0 : null; // push: the content is uploaded to every edge up front
  return { mode, ttl, now: 0, edges: { us: published, eu: published, asia: published } };
}

export interface Served { by: 'edge' | 'origin'; ms: number; reason: string; state: CdnState }

export function request(prev: CdnState, region: Region): Served {
  const state: CdnState = { ...prev, edges: { ...prev.edges } };
  if (state.mode === 'none') return { by: 'origin', ms: ORIGIN_MS[region], reason: 'No CDN: every request travels to the origin.', state };
  const cachedAt = state.edges[region];
  const fresh = cachedAt !== null && (state.mode === 'push' || state.now - cachedAt < state.ttl);
  if (fresh) return { by: 'edge', ms: EDGE_MS, reason: 'The nearby edge had a copy.', state };
  const expired = cachedAt !== null;
  state.edges[region] = state.now;
  return {
    by: 'origin', ms: EDGE_MS + ORIGIN_MS[region], state,
    reason: expired
      ? 'The cached copy expired (its TTL ran out), so the edge fetched it again from the origin.'
      : 'First request here: the edge had nothing, so it fetched the file from the origin and kept a copy.',
  };
}

export const advance = (s: CdnState, ticks = 1): CdnState => ({ ...s, now: s.now + ticks, edges: { ...s.edges } });
export const purge = (s: CdnState): CdnState => ({ ...s, edges: { us: null, eu: null, asia: null } });
