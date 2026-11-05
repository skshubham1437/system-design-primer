// Walking a real query plan (EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)) in the order it does its work:
// children before parents, innermost first. Each step carries what a reader should look at: estimated versus
// actual rows, time spent in this node alone, pages read, and any red flags.
import type { PlanNode } from './checks';

export interface PlanStep {
  index: number;            // execution order, 0 first
  path: number[];           // position in the tree, e.g. [0, 1] = root's second child
  depth: number;
  node: PlanNode;
  label: string;            // "Seq Scan on orders"
  estRows: number;          // estimated rows per loop
  actualRows: number;       // actual rows per loop
  loops: number;
  totalRows: number;        // actual rows over all loops
  selfMs: number;           // time spent in this node, excluding its children
  totalMs: number;          // time including children, over all loops
  misestimate: number;      // ratio between estimate and actual, at least 1
  flags: string[];
}

/** The node name as the text format prints it: JSON reports HashAggregate as Aggregate with a strategy. */
export function nodeName(n: PlanNode): string {
  if (n['Node Type'] === 'Aggregate') return ({ Hashed: 'HashAggregate', Sorted: 'GroupAggregate', Mixed: 'MixedAggregate' } as Record<string, string>)[String(n.Strategy)] ?? 'Aggregate';
  return n['Node Type'];
}

export function label(n: PlanNode): string {
  const rel = n['Relation Name'] ? ` on ${n['Relation Name']}` : '';
  const idx = n['Index Name'] ? ` using ${n['Index Name']}` : '';
  const how = typeof n['Join Type'] === 'string' && n['Join Type'] !== 'Inner' ? ` (${n['Join Type']})` : '';
  return `${nodeName(n)}${how}${idx}${rel}`;
}

const num = (v: unknown) => (typeof v === 'number' ? v : 0);

export function planSteps(root: PlanNode): PlanStep[] {
  const steps: PlanStep[] = [];
  const visit = (n: PlanNode, path: number[]) => {
    // A hash join builds its hash table from the inner side (the Hash child) before it reads the outer side.
    const kids = (n.Plans ?? []).map((c, i) => ({ c, i }));
    if (n['Node Type'] === 'Hash Join') kids.reverse();
    for (const { c, i } of kids) visit(c, [...path, i]);
    const loops = num(n['Actual Loops']) || 1;
    const totalMs = num(n['Actual Total Time']) * loops;
    const childMs = (n.Plans ?? []).reduce((s, c) => s + num(c['Actual Total Time']) * (num(c['Actual Loops']) || 1), 0);
    const est = num(n['Plan Rows']);
    const act = num(n['Actual Rows']);
    const misestimate = Math.max(est, act, 1) / Math.max(Math.min(est, act), 1);
    const flags: string[] = [];
    const removed = num(n['Rows Removed by Filter']) * loops;
    if (n['Node Type'] === 'Seq Scan' && removed > 1000 && removed > 10 * act * loops) flags.push(`Read ${Math.round(removed + act * loops).toLocaleString('en-US')} rows to keep ${Math.round(act * loops).toLocaleString('en-US')}: an index on the filtered column may help.`);
    else if (removed > 1000 && removed > 10 * act * loops) flags.push(`A filter threw away ${Math.round(removed).toLocaleString('en-US')} rows after reading them.`);
    if (misestimate >= 10 && Math.max(est, act) >= 100) flags.push(`The planner expected ${est.toLocaleString('en-US')} rows and got ${act.toLocaleString('en-US')} (${Math.round(misestimate)}× off). Plans built on a bad estimate are often bad plans.`);
    if (typeof n['Sort Method'] === 'string' && /external/.test(n['Sort Method'])) flags.push(`The sort did not fit in memory (work_mem) and spilled to disk: ${n['Sort Method']}.`);
    if (n['Node Type'] === 'Nested Loop' && (n.Plans ?? []).some((c) => (num(c['Actual Loops']) || 1) > 1000)) flags.push('The inner side ran more than a thousand times. Fine when each run is an index lookup; costly when each run scans.');
    if (num(n['Temp Written Blocks']) > 0 && !flags.some((f) => f.includes('spilled'))) flags.push(`Wrote ${num(n['Temp Written Blocks'])} temporary pages: it ran out of working memory.`);
    steps.push({
      index: 0, path, depth: path.length, node: n, label: label(n),
      estRows: est, actualRows: act, loops, totalRows: act * loops,
      selfMs: Math.max(0, totalMs - childMs), totalMs, misestimate, flags,
    });
  };
  visit(root, [0]);
  steps.forEach((s, i) => (s.index = i));
  return steps;
}

/** The node where most of the time went (excluding children). */
export const hottest = (steps: PlanStep[]) => steps.reduce((a, b) => (b.selfMs > a.selfMs ? b : a), steps[0]);

/** A short, plain explanation of what each common node type does. */
export const NODE_HELP: Record<string, string> = {
  'Seq Scan': 'Reads the whole table, page after page, and tests every row against the filter.',
  'Index Scan': 'Walks the index to each matching entry and fetches that row from the table.',
  'Index Only Scan': 'Answers from the index alone; the table is only visited for pages not yet marked all-visible (Heap Fetches).',
  'Bitmap Index Scan': 'Walks the index and records where matching rows live, without fetching them yet.',
  'Bitmap Heap Scan': 'Fetches the rows found by the bitmap, page by page in table order, each page once.',
  'Sort': 'Puts its input in order. It must read all of it before it can return the first row.',
  'Incremental Sort': 'Sorts input that is already partly in order, one group at a time.',
  'Limit': 'Stops after enough rows. Below a Limit, nodes that can stream rows stop early too.',
  'Aggregate': 'Combines all its input into one row, such as count(*) or sum().',
  'HashAggregate': 'Groups rows using a hash table in memory, one entry per group.',
  'GroupAggregate': 'Groups rows that arrive already sorted by the grouping columns.',
  'Hash Join': 'Builds a hash table from one input (normally the smaller), then looks up each row of the other input in it.',
  'Hash': 'Builds the in-memory hash table for the Hash Join above it.',
  'Merge Join': 'Walks two inputs that are both sorted on the join key, side by side.',
  'Nested Loop': 'For each row from the outer input, runs the inner input once. Good when the inner side is an index lookup.',
  'Append': 'Returns the rows of each child in turn, for example each partition of a partitioned table.',
  'Materialize': 'Keeps its input in memory so it can be read again cheaply.',
  'Memoize': 'Caches results of the inner side of a nested loop for repeated parameter values.',
  'CTE Scan': 'Reads the rows of a WITH query that was computed separately.',
  'Subquery Scan': 'Reads the output of a subquery.',
  'Result': 'Computes values without reading a table.',
  'Unique': 'Removes adjacent duplicates from sorted input.',
  'WindowAgg': 'Computes window functions over its input, which usually arrives sorted by the window.',
};
