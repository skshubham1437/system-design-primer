// What a resolver's cache does when a DNS record changes: it keeps serving the old answer until the TTL it was
// given runs out. Time is in minutes.

export interface TtlState { now: number; ip: string; ttl: number; cached: { ip: string; at: number; ttl: number } | null }
export interface TtlLookup { state: TtlState; ip: string; fromCache: boolean; stale: boolean; expiresIn: number }

export const createTtl = (ttl = 60): TtlState => ({ now: 0, ip: '203.0.113.10', ttl, cached: null });

/** A user looks the name up through the resolver. */
export function lookupTtl(prev: TtlState): TtlLookup {
  const s: TtlState = { ...prev, cached: prev.cached && { ...prev.cached } };
  const c = s.cached;
  if (c && s.now - c.at < c.ttl) return { state: s, ip: c.ip, fromCache: true, stale: c.ip !== s.ip, expiresIn: c.ttl - (s.now - c.at) };
  s.cached = { ip: s.ip, at: s.now, ttl: s.ttl }; // the TTL in force when the answer was fetched is the one cached
  return { state: s, ip: s.ip, fromCache: false, stale: false, expiresIn: s.ttl };
}

/** The owner points the name at a new server. Caches do not hear about it. */
export const changeRecord = (s: TtlState, ip: string): TtlState => ({ ...s, ip });
export const setTtl = (s: TtlState, ttl: number): TtlState => ({ ...s, ttl });
export const passTime = (s: TtlState, minutes: number): TtlState => ({ ...s, now: s.now + minutes });
