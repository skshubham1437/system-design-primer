// Judging a query plan. Exercises are checked against the plan PostgreSQL actually chose, never against the
// text of the learner's SQL and never against timings (which vary from machine to machine).
// Pure functions over EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) output, so they are unit tested.

/** One node of EXPLAIN (FORMAT JSON) output. Only the fields used here are typed. */
export interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Total Cost'?: number;
  'Plan Rows'?: number;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Rows Removed by Filter'?: number;
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
  'Sort Method'?: string;
  Plans?: PlanNode[];
  [k: string]: unknown;
}

export type NodeMatch = { node: string | string[]; relation?: string };
export type Check =
  | { uses: NodeMatch }
  | { avoid: NodeMatch }
  | { max_buffers: number }
  | { max_rows_removed: number }
  | { max_cost: number };

export interface CheckResult { ok: boolean; label: string; detail: string }

export const CHECK_KINDS = ['uses', 'avoid', 'max_buffers', 'max_rows_removed', 'max_cost'] as const;

export function walk(n: PlanNode, visit: (n: PlanNode, depth: number) => void, depth = 0) {
  visit(n, depth);
  for (const c of n.Plans ?? []) walk(c, visit, depth + 1);
}

export function nodes(root: PlanNode): PlanNode[] {
  const all: PlanNode[] = [];
  walk(root, (n) => all.push(n));
  return all;
}

const matches = (n: PlanNode, m: NodeMatch) =>
  (Array.isArray(m.node) ? m.node : [m.node]).includes(n['Node Type']) && (!m.relation || n['Relation Name'] === m.relation);

const describe = (m: NodeMatch) => `${Array.isArray(m.node) ? m.node.join(' or ') : m.node}${m.relation ? ` on ${m.relation}` : ''}`;

/** Pages read: buffers found in memory plus buffers read in. The top node's figures include its children. */
export const buffers = (root: PlanNode) => (root['Shared Hit Blocks'] ?? 0) + (root['Shared Read Blocks'] ?? 0);

/** Rows that were read and then thrown away by a filter, across the whole plan (per-loop counts times loops). */
export const rowsRemoved = (root: PlanNode) => nodes(root).reduce((s, n) => s + (n['Rows Removed by Filter'] ?? 0) * (n['Actual Loops'] ?? 1), 0);

export function evaluate(root: PlanNode, checks: Check[]): CheckResult[] {
  const all = nodes(root);
  return checks.map((c): CheckResult => {
    if ('uses' in c) {
      const hit = all.find((n) => matches(n, c.uses));
      return { ok: !!hit, label: `Uses ${describe(c.uses)}`, detail: hit ? `Found ${hit['Node Type']}${hit['Index Name'] ? ` using ${hit['Index Name']}` : ''}.` : `The plan has no ${describe(c.uses)}.` };
    }
    if ('avoid' in c) {
      const hit = all.find((n) => matches(n, c.avoid));
      return { ok: !hit, label: `No ${describe(c.avoid)}`, detail: hit ? `The plan still has ${hit['Node Type']}${hit['Relation Name'] ? ` on ${hit['Relation Name']}` : ''}.` : 'None in the plan.' };
    }
    if ('max_buffers' in c) {
      const b = buffers(root);
      return { ok: b <= c.max_buffers, label: `Reads at most ${c.max_buffers.toLocaleString('en-US')} pages`, detail: `It read ${b.toLocaleString('en-US')} pages (8 kB each).` };
    }
    if ('max_rows_removed' in c) {
      const r = rowsRemoved(root);
      return { ok: r <= c.max_rows_removed, label: `Throws away at most ${c.max_rows_removed.toLocaleString('en-US')} rows`, detail: `Filters discarded ${r.toLocaleString('en-US')} rows after reading them.` };
    }
    const cost = root['Total Cost'] ?? Infinity;
    return { ok: cost <= c.max_cost, label: `Estimated cost at most ${c.max_cost.toLocaleString('en-US')}`, detail: `The planner estimated ${cost.toLocaleString('en-US')}.` };
  });
}

/** Validate one check object from content. Returns a problem, or null if it is fine. */
export function checkProblem(c: unknown): string | null {
  if (!c || typeof c !== 'object') return 'a check must be an object';
  const keys = Object.keys(c);
  if (keys.length !== 1 || !(CHECK_KINDS as readonly string[]).includes(keys[0])) return `unknown check ${JSON.stringify(c)}; use one of ${CHECK_KINDS.join(', ')}`;
  const v = (c as Record<string, unknown>)[keys[0]];
  if (keys[0] === 'uses' || keys[0] === 'avoid') {
    const m = v as NodeMatch;
    if (!m || (typeof m.node !== 'string' && !Array.isArray(m.node))) return `${keys[0]} needs a node type`;
    return null;
  }
  return typeof v === 'number' && v >= 0 ? null : `${keys[0]} needs a non-negative number`;
}
