// A tiny model of primary/replica replication, used by the replication visual.
// Time moves in ticks. Replication is asynchronous (the client is told "done" straight away) or
// synchronous (the client is told "done" only once every live replica has the write).

export type Mode = 'async' | 'sync';

export interface Node { id: number; up: boolean; version: number; primary: boolean }
export interface Pending { to: number; version: number; deliverAt: number }

export interface State {
  tick: number;
  mode: Mode;
  lag: number;            // ticks a write takes to reach a replica
  nodes: Node[];
  pending: Pending[];     // replication messages still travelling
  acked: number;          // highest version the client has been told succeeded
  awaiting: number[];     // sync writes not yet acknowledged
  log: string[];
}

export const create = (mode: Mode = 'async', lag = 2, replicas = 2): State => ({
  tick: 0, mode, lag, acked: 0, pending: [], awaiting: [], log: [],
  nodes: Array.from({ length: replicas + 1 }, (_, id) => ({ id, up: true, version: 0, primary: id === 0 })),
});

export const primary = (s: State) => s.nodes.find((n) => n.primary && n.up);
const clone = (s: State): State => structuredClone(s);
const say = (s: State, m: string) => { s.log = [m, ...s.log].slice(0, 6); };

/** The client writes. Returns the new state; if there is no live primary the write fails. */
export function write(prev: State): State {
  const s = clone(prev);
  const p = primary(s);
  if (!p) { say(s, 'Write failed: there is no primary. Promote a replica first.'); return s; }
  p.version += 1;
  for (const n of s.nodes) if (!n.primary && n.up) s.pending.push({ to: n.id, version: p.version, deliverAt: s.tick + s.lag });
  if (s.mode === 'async') { s.acked = p.version; say(s, `Write v${p.version} acknowledged immediately; replicas will catch up.`); }
  else if (s.pending.some((m) => m.version === p.version)) { s.awaiting.push(p.version); say(s, `Write v${p.version} waits for every replica before it is acknowledged.`); }
  else { s.acked = p.version; say(s, `Write v${p.version} acknowledged (no replicas to wait for).`); }
  return s;
}

/** Let one tick pass: deliver messages that have arrived and acknowledge sync writes that are complete. */
export function advance(prev: State): State {
  const s = clone(prev);
  s.tick += 1;
  const due = s.pending.filter((m) => m.deliverAt <= s.tick);
  s.pending = s.pending.filter((m) => m.deliverAt > s.tick);
  for (const m of due) { const n = s.nodes[m.to]; if (n.up) n.version = Math.max(n.version, m.version); }
  for (const v of [...s.awaiting]) {
    if (!s.pending.some((m) => m.version === v)) {
      s.awaiting = s.awaiting.filter((x) => x !== v);
      s.acked = Math.max(s.acked, v);
      say(s, `Write v${v} acknowledged: every replica has it.`);
    }
  }
  return s;
}

export interface ReadResult { ok: boolean; version?: number; behind?: number; message: string }

/** Read from a node. `behind` is how many acknowledged versions that node is missing. */
export function read(s: State, id: number): ReadResult {
  const n = s.nodes[id];
  if (!n.up) return { ok: false, message: `Node ${id + 1} is down.` };
  const behind = Math.max(0, s.acked - n.version);
  return { ok: true, version: n.version, behind, message: behind ? `Node ${id + 1} returned v${n.version}, but v${s.acked} was already acknowledged: a stale read.` : `Node ${id + 1} returned v${n.version}, which is current.` };
}

/** The primary fails. Replication messages it had not yet sent are lost with it. */
export function crashPrimary(prev: State): State {
  const s = clone(prev);
  const p = primary(s);
  if (!p) return s;
  p.up = false;
  const lost = s.pending.length;
  s.pending = [];
  s.awaiting = [];
  say(s, `The primary crashed.${lost ? ` ${lost} replication message${lost === 1 ? ' was' : 's were'} still in flight and never arrived.` : ''}`);
  return s;
}

/** Promote the live replica with the most data. Returns how many acknowledged versions were lost. */
export function promote(prev: State): { state: State; lost: number } {
  const s = clone(prev);
  const candidates = s.nodes.filter((n) => n.up && !n.primary).sort((a, b) => b.version - a.version);
  if (!candidates.length) { say(s, 'There is no replica to promote.'); return { state: s, lost: 0 }; }
  for (const n of s.nodes) n.primary = false;
  const winner = candidates[0];
  winner.primary = true;
  const lost = Math.max(0, s.acked - winner.version);
  s.acked = Math.min(s.acked, winner.version);
  say(s, lost
    ? `Node ${winner.id + 1} is the new primary at v${winner.version}. ${lost} write${lost === 1 ? '' : 's'} the client was told succeeded are gone for good.`
    : `Node ${winner.id + 1} is the new primary at v${winner.version}. Nothing that was acknowledged was lost.`);
  return { state: s, lost };
}

export function recover(prev: State, id: number): State {
  const s = clone(prev);
  const n = s.nodes[id];
  if (n.up) return s;
  n.up = true;
  const p = primary(s);
  // a recovered node rejoins as a replica and copies the current primary
  n.primary = false;
  if (p) { s.pending.push({ to: id, version: p.version, deliverAt: s.tick + s.lag }); n.version = Math.min(n.version, p.version); }
  say(s, `Node ${id + 1} is back as a replica and is catching up.`);
  return s;
}
