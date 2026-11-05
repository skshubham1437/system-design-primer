// Three ways to find rows in a table, side by side on the same tiny table: a sequential scan, an index scan and
// a bitmap scan. Each produces steps for an animation and the counts that explain the planner's choice.
//
// The table is a heap: rows sit in pages in the order they were written. The index is sorted by value, and for
// equal values by row position (true of PostgreSQL B-trees since version 12), so an index scan over a RANGE of
// values jumps between pages, while a bitmap scan sorts the row positions first and reads each page once.
import { mulberry32 } from '../sim';

export interface Row { page: number; slot: number; value: number }
export type ScanKind = 'seq' | 'index' | 'bitmap';
export interface ScanStep {
  note: string;
  page?: number;          // the table page being read, if any
  examined: number[];     // row numbers looked at in this step
  matched: number[];      // row numbers that satisfied the condition in this step
  indexPhase?: boolean;   // the step is inside the index, not the table
  pageReads: number;      // table page reads so far, counting a page again each time it is visited
  distinctPages: number;  // different table pages touched so far
  rowsExamined: number;   // table rows inspected so far
  returned: number;       // rows returned so far
}

export const PAGES = 12;
export const PER_PAGE = 8;

/** 96 rows with values 1 to 50, written in random order, like orders arriving over time. */
export function makeTable(seed = 4): Row[] {
  const r = mulberry32(seed);
  return Array.from({ length: PAGES * PER_PAGE }, (_, i) => ({ page: Math.floor(i / PER_PAGE), slot: i % PER_PAGE, value: 1 + Math.floor(r() * 50) }));
}

/** Rows (by number) whose value is in [lo, hi], in index order: by value, then by position in the table. */
export function indexOrder(table: Row[], lo: number, hi: number): number[] {
  return table.map((row, i) => ({ row, i })).filter(({ row }) => row.value >= lo && row.value <= hi)
    .sort((a, b) => a.row.value - b.row.value || a.i - b.i).map(({ i }) => i);
}

export function scanSteps(table: Row[], kind: ScanKind, lo: number, hi: number): ScanStep[] {
  const steps: ScanStep[] = [];
  const pagesSeen = new Set<number>();
  let pageReads = 0, rowsExamined = 0, returned = 0;
  const push = (s: Omit<ScanStep, 'pageReads' | 'distinctPages' | 'rowsExamined' | 'returned'>) =>
    steps.push({ ...s, pageReads, distinctPages: pagesSeen.size, rowsExamined, returned });
  const inRange = (i: number) => table[i].value >= lo && table[i].value <= hi;

  if (kind === 'seq') {
    for (let p = 0; p < PAGES; p++) {
      const rows = table.map((_, i) => i).filter((i) => table[i].page === p);
      const hits = rows.filter(inRange);
      pageReads++; pagesSeen.add(p); rowsExamined += rows.length; returned += hits.length;
      push({ page: p, examined: rows, matched: hits, note: `Read page ${p + 1} from start to end and test all ${rows.length} rows: ${hits.length ? `${hits.length} match${hits.length === 1 ? 'es' : ''}.` : 'none match.'}` });
    }
    push({ examined: [], matched: [], note: `Every page read once, in order, and every row tested. Reading pages in order is the cheapest kind of reading there is, but all ${rowsExamined} rows were examined to return ${returned}.` });
    return steps;
  }

  const order = indexOrder(table, lo, hi);
  if (kind === 'index') {
    push({ examined: [], matched: [], indexPhase: true, note: `Descend the index to the first entry with a value of at least ${lo}. The entries are sorted by value.` });
    for (const i of order) {
      const p = table[i].page;
      const again = pagesSeen.has(p);
      pageReads++; pagesSeen.add(p); rowsExamined++; returned++;
      push({ page: p, examined: [i], matched: [i], note: `Next index entry: value ${table[i].value}, row ${i + 1}. Fetch it from page ${p + 1}${again ? ', a page already visited: by value order, rows that live together are not fetched together' : ''}.` });
    }
    push({ examined: [], matched: [], indexPhase: true, note: `${returned} rows, each fetched as its index entry came up: ${pageReads} page visits across ${pagesSeen.size} different pages. Only matching rows were touched, but in an order that jumps around the table.` });
    return steps;
  }

  // bitmap: collect every matching position from the index, sort them by page, then read each page once
  push({ examined: [], matched: [], indexPhase: true, note: `Walk the index for values ${lo} to ${hi} and note where each matching row lives, without fetching anything yet.` });
  const pages = [...new Set(order.map((i) => table[i].page))].sort((a, b) => a - b);
  push({ examined: [], matched: [], indexPhase: true, note: `Sort those positions by page: ${order.length} rows on ${pages.length} pages. Now each page will be read once, in table order.` });
  for (const p of pages) {
    const hits = order.filter((i) => table[i].page === p).sort((a, b) => a - b);
    pageReads++; pagesSeen.add(p); rowsExamined += hits.length; returned += hits.length;
    push({ page: p, examined: hits, matched: hits, note: `Read page ${p + 1} once and take its ${hits.length} matching row${hits.length === 1 ? '' : 's'}.` });
  }
  push({ examined: [], matched: [], note: `${returned} rows from ${pageReads} page reads, each page once and in order: the index found them, and the sort stopped the jumping around.` });
  return steps;
}

export const finalCounts = (steps: ScanStep[]) => steps[steps.length - 1];
