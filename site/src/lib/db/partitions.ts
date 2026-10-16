// Partition pruning on the sample events table: twelve monthly partitions of 2024, partitioned by range on `at`.
// For each kind of condition, which partitions the planner can skip before running anything, and why.

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface PruneQuery { id: string; label: string; sql: string; scanned: number[]; why: string }

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const all = range(0, 11);

export const PRUNE_QUERIES: PruneQuery[] = [
  { id: 'month', label: 'One month, as a range', sql: "where at >= '2024-11-01' and at < '2024-12-01'", scanned: [10],
    why: 'The condition compares the partition key with constants, so the planner checks each partition\'s bounds and keeps only November.' },
  { id: 'quarter', label: 'A quarter', sql: "where at >= '2024-04-01' and at < '2024-07-01'", scanned: range(3, 5),
    why: 'Three partitions overlap the range; the other nine are skipped.' },
  { id: 'since', label: 'Everything since a date', sql: "where at >= '2024-10-15'", scanned: range(9, 11),
    why: 'October overlaps the range partly, November and December fully. Earlier months cannot contain a match.' },
  { id: 'function', label: 'A function of the key', sql: "where date_trunc('month', at) = '2024-11-01'", scanned: all,
    why: 'date_trunc(\'month\', at) is a different value from at. The planner cannot compare it with partition bounds, so it must scan all twelve partitions.' },
  { id: 'other', label: 'A different column', sql: "where kind = 'purchase'", scanned: all,
    why: 'The table is partitioned by at, so a condition on kind says nothing about which partitions to skip.' },
  { id: 'or', label: 'Two separate months', sql: "where at < '2024-02-01' or at >= '2024-12-01'", scanned: [0, 11],
    why: 'Pruning works with OR too: each branch keeps the partitions it can match.' },
];

export function pruned(q: PruneQuery): number[] { return all.filter((m) => !q.scanned.includes(m)); }
