// Quorum reads and writes, as in Dynamo-style stores (Cassandra, Riak, DynamoDB's internals): N copies of each item,
// a write is acknowledged once W replicas have it, and a read asks R replicas and keeps the newest answer.
// If R + W > N, every set of R replicas overlaps every set of W, so a read always reaches the latest write.

export interface QuorumState { n: number; w: number; r: number; versions: number[]; up: boolean[]; latest: number; nextStart: number }
export interface QuorumResult { state: QuorumState; ok: boolean; message: string; touched: number[]; value?: number; stale?: boolean }

export const createQuorum = (n = 3, w = 2, r = 2): QuorumState => ({ n, w, r, versions: Array(n).fill(0), up: Array(n).fill(true), latest: 0, nextStart: 0 });

const clone = (s: QuorumState): QuorumState => ({ ...s, versions: [...s.versions], up: [...s.up] });
const live = (s: QuorumState) => s.up.map((u, i) => (u ? i : -1)).filter((i) => i >= 0);

/** Write a new version. It reaches W live replicas now; the others stay behind until they sync. */
export function quorumWrite(prev: QuorumState): QuorumResult {
  const s = clone(prev);
  const alive = live(s);
  if (alive.length < s.w) return { state: s, ok: false, touched: [], message: `Write refused: it needs ${s.w} replicas to confirm, but only ${alive.length} are reachable. Consistency is kept by giving up availability.` };
  // rotate which replicas receive it first, so different writes land on different sets
  const order = [...alive.slice(s.nextStart % alive.length), ...alive.slice(0, s.nextStart % alive.length)];
  const set = order.slice(0, s.w);
  s.latest += 1;
  for (const i of set) s.versions[i] = s.latest;
  s.nextStart += 1;
  return { state: s, ok: true, touched: set, value: s.latest, message: `Wrote v${s.latest}. Acknowledged after replicas ${set.map((i) => i + 1).join(', ')} confirmed (W = ${s.w}). The others have not received it yet.` };
}

/**
 * Read from R live replicas and keep the newest version. The replicas asked are the worst case: the most out of date
 * first. That is what the quorum rule has to survive, since in practice the fastest replicas to answer may be stale.
 */
export function quorumRead(prev: QuorumState): QuorumResult {
  const s = clone(prev);
  const alive = live(s);
  if (alive.length < s.r) return { state: s, ok: false, touched: [], message: `Read refused: it needs answers from ${s.r} replicas, but only ${alive.length} are reachable.` };
  const asked = [...alive].sort((a, b) => s.versions[a] - s.versions[b] || a - b).slice(0, s.r);
  const value = Math.max(...asked.map((i) => s.versions[i]));
  const stale = value < s.latest;
  return { state: s, ok: true, touched: asked, value, stale,
    message: stale
      ? `Read v${value} from replicas ${asked.map((i) => i + 1).join(', ')}: STALE, the latest is v${s.latest}. None of the replicas asked had it, because R + W = ${s.r + s.w} is not more than N = ${s.n}.`
      : `Read v${value} from replicas ${asked.map((i) => i + 1).join(', ')}: current. ${s.r + s.w > s.n ? `R + W = ${s.r + s.w} > N = ${s.n}, so at least one of them was in the write set.` : 'Lucky: a replica asked happened to have it.'}` };
}

/** Background repair: every live replica catches up with the newest version any live replica has. */
export function quorumSync(prev: QuorumState): QuorumState {
  const s = clone(prev);
  const best = Math.max(...live(s).map((i) => s.versions[i]), 0);
  for (const i of live(s)) s.versions[i] = best;
  return s;
}

export function toggleReplica(prev: QuorumState, i: number): QuorumState {
  const s = clone(prev);
  s.up[i] = !s.up[i];
  return s;
}

/** The two rules worth remembering, for the page and the tests. */
export const overlaps = (s: Pick<QuorumState, 'n' | 'w' | 'r'>) => s.r + s.w > s.n;
export const tolerates = (s: Pick<QuorumState, 'n' | 'w' | 'r'>) => ({ writes: s.n - s.w, reads: s.n - s.r });
