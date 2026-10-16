// A small B+tree, the structure behind PostgreSQL's default index, kept tiny (a few keys per node) so every
// split is visible. Keys live in the leaves; internal nodes hold separators; leaves are linked left to right,
// which is what makes range scans cheap. Every operation returns the steps an animation needs, each with a
// snapshot of the tree at that moment.

export interface BNode { id: number; leaf: boolean; keys: number[]; children: number[]; next: number | null }
export interface BTree { nodes: Record<number, BNode>; root: number; nextId: number; max: number }
export interface BStep { tree: BTree; focus: number[]; note: string; hit?: number[] }

const clone = (t: BTree): BTree => ({ ...t, nodes: Object.fromEntries(Object.entries(t.nodes).map(([k, n]) => [k, { ...n, keys: [...n.keys], children: [...n.children] }])) });

export function emptyTree(max = 3): BTree {
  return { nodes: { 1: { id: 1, leaf: true, keys: [], children: [], next: null } }, root: 1, nextId: 2, max };
}

/** Index of the child to follow for `key`: keys equal to a separator go right, as in a B+tree. */
const childIndex = (n: BNode, key: number) => { let i = 0; while (i < n.keys.length && key >= n.keys[i]) i++; return i; };

function pathTo(t: BTree, key: number): number[] {
  const path = [t.root];
  let n = t.nodes[t.root];
  while (!n.leaf) { const c = n.children[childIndex(n, key)]; path.push(c); n = t.nodes[c]; }
  return path;
}

export function search(t: BTree, key: number): BStep[] {
  const path = pathTo(t, key);
  const steps: BStep[] = path.map((id, i) => {
    const n = t.nodes[id];
    return { tree: t, focus: [id], note: n.leaf ? `Leaf page: look for ${key} among ${n.keys.join(', ') || 'nothing'}.` : `${i === 0 ? 'Root' : 'Inner'} page: ${key} is ${describeBranch(n, key)}, so go down that branch.` };
  });
  const leaf = t.nodes[path[path.length - 1]];
  const found = leaf.keys.includes(key);
  steps.push({ tree: t, focus: [leaf.id], hit: found ? [key] : [], note: found ? `Found ${key} after reading ${path.length} page${path.length === 1 ? '' : 's'}, one per level. The entry points to the row in the table.` : `${key} is not in the index. That took ${path.length} page reads too: a miss costs the same as a hit.` });
  return steps;
}

function describeBranch(n: BNode, key: number): string {
  const i = childIndex(n, key);
  if (i === 0) return `below ${n.keys[0]}`;
  if (i === n.keys.length) return `${n.keys[i - 1]} or more`;
  return `from ${n.keys[i - 1]} up to ${n.keys[i]}`;
}

export function insert(t0: BTree, key: number): { tree: BTree; steps: BStep[] } {
  const w = clone(t0); // the working tree; every step stores its own copy, so later changes never rewrite an earlier frame
  const steps: BStep[] = [];
  const snap = (focus: number[], note: string, hit?: number[]) => steps.push({ tree: clone(w), focus, note, hit });
  const path = pathTo(w, key);
  for (const id of path.slice(0, -1)) snap([id], `Find where ${key} belongs: ${describeBranch(w.nodes[id], key)}.`);
  const leaf = w.nodes[path[path.length - 1]];
  if (leaf.keys.includes(key)) { snap([leaf.id], `${key} is already there. A unique index would reject it; this one keeps one copy.`, [key]); return { tree: w, steps }; }
  leaf.keys.push(key); leaf.keys.sort((a, b) => a - b);
  snap([leaf.id], `Put ${key} into the leaf, keeping it sorted.`, [key]);

  // split upwards while a node is over-full
  for (let level = path.length - 1; level >= 0; level--) {
    const n = w.nodes[path[level]];
    if (n.keys.length <= w.max) break;
    const right: BNode = { id: w.nextId++, leaf: n.leaf, keys: [], children: [], next: null };
    let up: number;
    if (n.leaf) {
      const cut = Math.ceil(n.keys.length / 2);
      right.keys = n.keys.slice(cut); n.keys = n.keys.slice(0, cut);
      right.next = n.next; n.next = right.id;
      up = right.keys[0]; // copied up: leaves keep every key
    } else {
      const mid = Math.floor(n.keys.length / 2);
      up = n.keys[mid];   // moved up: inner separators are not repeated
      right.keys = n.keys.slice(mid + 1); right.children = n.children.slice(mid + 1);
      n.keys = n.keys.slice(0, mid); n.children = n.children.slice(0, mid + 1);
    }
    w.nodes[right.id] = right;
    if (level === 0) {
      const root: BNode = { id: w.nextId++, leaf: false, keys: [up], children: [n.id, right.id], next: null };
      w.nodes[root.id] = root; w.root = root.id;
      snap([n.id, right.id, root.id], `The page was full, so it split in two, and there was no parent to take the boundary, so a new root holds ${up}. The tree is now one level taller. This is the only way a B-tree grows in height, which is why every leaf stays the same distance from the root.`);
    } else {
      const parent = w.nodes[path[level - 1]];
      const at = parent.children.indexOf(n.id);
      parent.keys.splice(at, 0, up); parent.children.splice(at + 1, 0, right.id);
      snap([n.id, right.id, parent.id], `The ${n.leaf ? 'leaf' : 'inner'} page held more than ${w.max} keys, so it split in two and ${up} went up to the parent as the new boundary.`);
    }
  }
  return { tree: w, steps };
}

/** Every key from lo to hi: one descent to the first leaf, then sideways along the leaf links. */
export function range(t: BTree, lo: number, hi: number): BStep[] {
  const path = pathTo(t, lo);
  const steps: BStep[] = path.slice(0, -1).map((id) => ({ tree: t, focus: [id], note: `Descend to where ${lo} would be: ${describeBranch(t.nodes[id], lo)}.` }));
  let id: number | null = path[path.length - 1];
  const got: number[] = [];
  let leaves = 0;
  while (id !== null) {
    const n: BNode = t.nodes[id];
    leaves++;
    const take = n.keys.filter((k) => k >= lo && k <= hi);
    got.push(...take);
    const done = n.keys.some((k) => k > hi) || n.next === null;
    steps.push({ tree: t, focus: [n.id], hit: [...got], note: take.length ? `Read ${take.join(', ')} from this leaf${done ? '.' : ', then follow the link to the next leaf.'}` : `Nothing in range here${done ? '.' : '; follow the link to the next leaf.'}` });
    if (done) break;
    id = n.next;
  }
  steps.push({ tree: t, focus: [], hit: got, note: `${got.length} key${got.length === 1 ? '' : 's'} from ${lo} to ${hi}, in order, after one descent and ${leaves} leaf page${leaves === 1 ? '' : 's'}. Sorted order is free: the leaves are already in order.` });
  return steps;
}

export const build = (keys: number[], max = 3) => keys.reduce((t, k) => insert(t, k).tree, emptyTree(max));

export function height(t: BTree): number {
  let h = 1, n = t.nodes[t.root];
  while (!n.leaf) { n = t.nodes[n.children[0]]; h++; }
  return h;
}

/** Leaves in order, following the sibling links from the leftmost one. */
export function leafChain(t: BTree): BNode[] {
  let n = t.nodes[t.root];
  while (!n.leaf) n = t.nodes[n.children[0]];
  const out = [n];
  while (n.next !== null) { n = t.nodes[n.next]; out.push(n); }
  return out;
}

/** Problems with the tree's shape; empty when it is a valid B+tree. Used by the tests. */
export function problems(t: BTree): string[] {
  const out: string[] = [];
  const leafDepths = new Set<number>();
  const visit = (id: number, depth: number, lo: number, hi: number) => {
    const n = t.nodes[id];
    if (n.keys.length > t.max) out.push(`node ${id} has ${n.keys.length} keys`);
    if (n.keys.some((k, i) => i > 0 && k <= n.keys[i - 1])) out.push(`node ${id} keys out of order`);
    if (n.keys.some((k) => k < lo || k >= hi)) out.push(`node ${id} has a key outside [${lo}, ${hi})`);
    if (n.leaf) { leafDepths.add(depth); return; }
    if (n.children.length !== n.keys.length + 1) out.push(`node ${id} has ${n.children.length} children for ${n.keys.length} keys`);
    n.children.forEach((c, i) => visit(c, depth + 1, i === 0 ? lo : n.keys[i - 1], i === n.keys.length ? hi : n.keys[i]));
  };
  visit(t.root, 0, -Infinity, Infinity);
  if (leafDepths.size > 1) out.push('leaves at different depths');
  const chain = leafChain(t).flatMap((n) => n.keys);
  if (chain.some((k, i) => i > 0 && k <= chain[i - 1])) out.push('leaf chain not in order');
  return out;
}

export interface Placed { id: number; x: number; y: number; w: number; keys: number[]; leaf: boolean }

/** Positions for drawing: leaves spread evenly along the bottom, each parent centred over its children. */
export function layout(t: BTree, opts = { keyW: 28, gap: 14, levelH: 70 }): { nodes: Placed[]; edges: [number, number][]; width: number; height: number } {
  const levels: number[][] = [];
  const walk = (id: number, d: number) => { (levels[d] ??= []).push(id); const n = t.nodes[id]; if (!n.leaf) n.children.forEach((c) => walk(c, d + 1)); };
  walk(t.root, 0);
  const wOf = (id: number) => Math.max(1, t.nodes[id].keys.length) * opts.keyW + 8;
  const pos = new Map<number, { x: number; w: number }>();
  let x = 0;
  for (const id of levels[levels.length - 1]) { const w = wOf(id); pos.set(id, { x, w }); x += w + opts.gap; }
  const width = Math.max(x - opts.gap, 1);
  for (let d = levels.length - 2; d >= 0; d--) {
    for (const id of levels[d]) {
      const kids = t.nodes[id].children.map((c) => pos.get(c)!);
      const centre = (kids[0].x + kids[kids.length - 1].x + kids[kids.length - 1].w) / 2;
      const w = wOf(id);
      pos.set(id, { x: centre - w / 2, w });
    }
  }
  const nodes: Placed[] = levels.flatMap((ids, d) => ids.map((id) => ({ id, x: pos.get(id)!.x, y: d * opts.levelH, w: pos.get(id)!.w, keys: t.nodes[id].keys, leaf: t.nodes[id].leaf })));
  const edges: [number, number][] = Object.values(t.nodes).filter((n) => !n.leaf).flatMap((n) => n.children.map((c) => [n.id, c] as [number, number]));
  return { nodes, edges, width, height: levels.length * opts.levelH };
}
