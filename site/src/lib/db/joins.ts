// The three join algorithms PostgreSQL uses, run step by step on two tiny tables so the work can be counted.
// orders (the outer input) joined to users (the inner input) on orders.user_id = users.id.

export interface JRow { key: number; label: string }
export type JoinAlgo = 'nested' | 'nested-index' | 'hash' | 'merge';
export interface JoinStep {
  phase: 'build' | 'sort' | 'probe' | 'scan' | 'done';
  note: string;
  outer?: number;          // index into the outer list being worked on
  inner?: number[];        // indexes into the inner list compared in this step
  bucket?: number;         // hash bucket in use
  buckets?: number[][];    // hash table: inner indexes per bucket (after the build)
  outerOrder?: number[];   // order the outer rows are visited in (merge join sorts them)
  innerOrder?: number[];
  matched: [number, number][]; // all (outer, inner) pairs output so far
  comparisons: number;
  innerReads: number;
  memory: number;          // rows held in memory (hash table)
}

export const OUTER: JRow[] = [
  { key: 3, label: 'order 1' }, { key: 1, label: 'order 2' }, { key: 5, label: 'order 3' }, { key: 3, label: 'order 4' },
  { key: 2, label: 'order 5' }, { key: 9, label: 'order 6' }, { key: 1, label: 'order 7' }, { key: 4, label: 'order 8' },
];
export const INNER: JRow[] = [
  { key: 4, label: 'user 4' }, { key: 1, label: 'user 1' }, { key: 6, label: 'user 6' }, { key: 3, label: 'user 3' }, { key: 2, label: 'user 2' }, { key: 5, label: 'user 5' },
];
export const BUCKETS = 3;

export function joinSteps(algo: JoinAlgo, outer: JRow[] = OUTER, inner: JRow[] = INNER): JoinStep[] {
  const steps: JoinStep[] = [];
  const matched: [number, number][] = [];
  let comparisons = 0, innerReads = 0, memory = 0;
  const push = (s: Omit<JoinStep, 'matched' | 'comparisons' | 'innerReads' | 'memory'>) => steps.push({ ...s, matched: [...matched], comparisons, innerReads, memory });

  if (algo === 'nested') {
    outer.forEach((o, i) => {
      const hits: number[] = [];
      inner.forEach((r, j) => { comparisons++; innerReads++; if (r.key === o.key) { hits.push(j); matched.push([i, j]); } });
      push({ phase: 'scan', outer: i, inner: inner.map((_, j) => j), note: `${o.label} (user ${o.key}): read all ${inner.length} users and compare each. ${hits.length ? 'Match.' : 'No match.'}` });
    });
    push({ phase: 'done', note: `Every outer row read the whole inner table: ${outer.length} × ${inner.length} = ${comparisons} comparisons. Fine for tiny inputs; hopeless for big ones.` });
    return steps;
  }

  if (algo === 'nested-index') {
    outer.forEach((o, i) => {
      const hits = inner.map((r, j) => ({ r, j })).filter(({ r }) => r.key === o.key).map(({ j }) => j);
      comparisons += 1; innerReads += hits.length; // one index probe, then fetch only the matches
      hits.forEach((j) => matched.push([i, j]));
      push({ phase: 'probe', outer: i, inner: hits, note: `${o.label} (user ${o.key}): one lookup in the index on users.id${hits.length ? `, then fetch that user.` : ', which finds nothing.'}` });
    });
    push({ phase: 'done', note: `One index lookup per outer row: ${outer.length} lookups, ${innerReads} rows fetched. This is the best join when the outer side is small and the inner side has an index on the join key.` });
    return steps;
  }

  if (algo === 'hash') {
    const buckets: number[][] = Array.from({ length: BUCKETS }, () => []);
    inner.forEach((r, j) => {
      const b = r.key % BUCKETS;
      buckets[b].push(j); innerReads++; memory++;
      push({ phase: 'build', inner: [j], bucket: b, buckets: buckets.map((x) => [...x]), note: `Build: put ${r.label} into bucket ${b} (its key ${r.key} hashes to ${b}).` });
    });
    outer.forEach((o, i) => {
      const b = o.key % BUCKETS;
      const hits: number[] = [];
      for (const j of buckets[b]) { comparisons++; if (inner[j].key === o.key) { hits.push(j); matched.push([i, j]); } }
      push({ phase: 'probe', outer: i, inner: buckets[b], bucket: b, buckets, note: `Probe: ${o.label} (user ${o.key}) hashes to bucket ${b}; compare with the ${buckets[b].length} user${buckets[b].length === 1 ? '' : 's'} in it. ${hits.length ? 'Match.' : 'No match.'}` });
    });
    push({ phase: 'done', buckets, note: `Each table read once. The inner side was held in memory (${memory} rows) and each outer row compared only within its bucket: ${comparisons} comparisons. If the hash table does not fit in work_mem, it is split into batches written to disk.` });
    return steps;
  }

  // merge join: sort both sides by key, then walk them together
  const oOrder = outer.map((_, i) => i).sort((a, b) => outer[a].key - outer[b].key || a - b);
  const iOrder = inner.map((_, j) => j).sort((a, b) => inner[a].key - inner[b].key || a - b);
  push({ phase: 'sort', outerOrder: oOrder, innerOrder: iOrder, note: 'Sort both inputs by the join key (or read them from indexes that are already in that order).' });
  let p = 0;
  for (const i of oOrder) {
    const key = outer[i].key;
    while (p < iOrder.length && inner[iOrder[p]].key < key) { comparisons++; innerReads++; p++; }
    const hits: number[] = [];
    let q = p;
    while (q < iOrder.length && inner[iOrder[q]].key === key) { comparisons++; hits.push(iOrder[q]); matched.push([i, iOrder[q]]); q++; }
    if (q < iOrder.length) comparisons++;
    push({ phase: 'scan', outer: i, inner: hits.length ? hits : (p < iOrder.length ? [iOrder[p]] : []), outerOrder: oOrder, innerOrder: iOrder, note: `${outer[i].label} (user ${key}): move along the sorted users until the key is ${key} or larger. ${hits.length ? 'Match.' : 'No match; the pointer stays for the next order.'}` });
  }
  innerReads = inner.length;
  push({ phase: 'done', outerOrder: oOrder, innerOrder: iOrder, note: `After sorting, one pass over each side: ${comparisons} comparisons. Good for two large inputs that are already sorted, for example by their indexes; the sort itself costs extra when they are not.` });
  return steps;
}

/** The pairs every correct join must produce, for the tests. */
export const expectedPairs = (outer: JRow[] = OUTER, inner: JRow[] = INNER) =>
  outer.flatMap((o, i) => inner.map((r, j) => [i, j] as [number, number]).filter(([, j]) => inner[j].key === o.key));
