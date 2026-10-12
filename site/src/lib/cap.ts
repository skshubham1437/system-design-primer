// Three replicas and a network that can be cut. Node 3 (index 2) is the one that gets isolated.
// CP mode: a node that cannot reach a majority refuses reads and writes.
// AP mode: every node answers with what it has; on healing, last-write-wins reconciles.

export type CapMode = 'cp' | 'ap';
export interface Replica { value: string; ts: number }
export interface DivergedWrite { node: number; side: number; value: string; ts: number }
export interface CapState { mode: CapMode; partitioned: boolean; clock: number; writes: number; nodes: Replica[]; diverged: DivergedWrite[] }
export interface CapEvent { kind: 'ok' | 'bad' | 'info'; text: string }

export const createCap = (mode: CapMode = 'cp'): CapState => ({
  mode, partitioned: false, clock: 0, writes: 0, diverged: [],
  nodes: [{ value: '—', ts: 0 }, { value: '—', ts: 0 }, { value: '—', ts: 0 }],
});

const clone = (s: CapState): CapState => ({ ...s, nodes: s.nodes.map((n) => ({ ...n })), diverged: s.diverged.map((d) => ({ ...d })) });
export const sideOf = (s: CapState, i: number) => (s.partitioned && i === 2 ? 1 : 0);
export const peersOf = (s: CapState, i: number) => [0, 1, 2].filter((j) => sideOf(s, j) === sideOf(s, i));
export const hasQuorum = (s: CapState, i: number) => peersOf(s, i).length >= 2;
const latestTs = (s: CapState) => Math.max(...s.nodes.map((n) => n.ts));

export function capWrite(prev: CapState, i: number): { state: CapState; event: CapEvent } {
  const s = clone(prev);
  if (s.mode === 'cp' && !hasQuorum(s, i)) {
    return { state: s, event: { kind: 'bad', text: `Write to node ${i + 1} rejected: it can only reach ${peersOf(s, i).length} of 3 nodes, so it has no quorum. Unavailable, but nothing inconsistent was stored.` } };
  }
  const value = `v${++s.writes}`;
  const ts = ++s.clock;
  const peers = peersOf(s, i);
  for (const j of peers) s.nodes[j] = { value, ts };
  if (s.partitioned) s.diverged.push({ node: i, side: sideOf(s, i), value, ts });
  const where = peers.length === 3 ? 'all nodes' : `node${peers.length > 1 ? 's' : ''} ${peers.map((x) => x + 1).join(' and ')}`;
  return { state: s, event: { kind: 'ok', text: `Wrote ${value} via node ${i + 1}; replicated to ${where}.` } };
}

export function capRead(s: CapState, i: number): CapEvent {
  if (s.mode === 'cp' && !hasQuorum(s, i)) return { kind: 'bad', text: `Read from node ${i + 1} refused: it cannot confirm its data is current. Unavailable.` };
  const latest = latestTs(s);
  const stale = s.nodes[i].ts < latest;
  return stale
    ? { kind: 'bad', text: `Node ${i + 1} answered ${s.nodes[i].value} which is STALE: another node already has ${s.nodes.find((n) => n.ts === latest)!.value}.` }
    : { kind: 'ok', text: `Node ${i + 1} answered ${s.nodes[i].value}.` };
}

/**
 * Cut or heal the network. On healing, the newest value wins everywhere. If both sides accepted writes,
 * the value the losing side ended up with is discarded. Earlier writes on either side that were simply
 * overwritten by a later write on the same side are ordinary overwrites, not losses, so they are not listed.
 */
export function capSetPartition(prev: CapState, on: boolean): { state: CapState; event?: CapEvent; lost: string[] } {
  const s = clone(prev);
  if (on === s.partitioned) return { state: s, lost: [] };
  s.partitioned = on;
  if (on) { s.diverged = []; return { state: s, lost: [], event: { kind: 'info', text: 'Network cut. Node 3 is now isolated from nodes 1 and 2.' } }; }
  const winner = s.nodes.reduce((a, b) => (b.ts > a.ts ? b : a));
  const winningSide = s.diverged.find((w) => w.ts === winner.ts)?.side;
  const sides = new Set(s.diverged.map((w) => w.side));
  const lost: string[] = [];
  if (sides.size > 1) {
    for (const side of sides) {
      if (side === winningSide) continue;
      const last = s.diverged.filter((w) => w.side === side).reduce((a, b) => (b.ts > a.ts ? b : a));
      lost.push(last.value);
    }
  }
  s.nodes = s.nodes.map(() => ({ ...winner }));
  s.diverged = [];
  const event: CapEvent = lost.length
    ? { kind: 'bad', text: `Network healed. Both sides accepted writes, so they conflicted. Last-write-wins kept ${winner.value} and silently discarded ${lost.join(', ')}, the last value written on the other side.` }
    : { kind: 'ok', text: `Network healed. Nodes reconciled on ${winner.value}.` };
  return { state: s, lost, event };
}
