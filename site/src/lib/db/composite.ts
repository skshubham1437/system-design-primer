// Which parts of a two-column index a query can use. The index is on (country, status): entries are sorted by
// country, and by status within each country. A query that fixes the leading column reads one contiguous slice.
// One that only fixes the second column cannot: before PostgreSQL 18 that meant reading the whole index or not
// using it; PostgreSQL 18 can "skip scan", jumping to each country in turn (one index search per country).

export interface Entry { country: string; status: string; row: number }
export interface IndexQuery { id: string; label: string; sql: string; countries?: string[]; statuses?: string[]; orderBy?: boolean }
export interface Usage { ranges: [number, number][]; matched: number; searches: number; kind: 'slice' | 'slices' | 'skip' | 'full' | 'ordered'; note: string }

export const COUNTRIES = ['BR', 'DE', 'IN', 'US'];
export const STATUSES = ['active', 'banned', 'inactive'];

export function makeEntries(): Entry[] {
  const out: Entry[] = [];
  let row = 1;
  // a fixed, uneven spread so slices have different sizes
  const counts: Record<string, number[]> = { BR: [3, 1, 2], DE: [3, 1, 1], IN: [5, 1, 2], US: [4, 1, 2] };
  for (const c of COUNTRIES) STATUSES.forEach((s, k) => { for (let i = 0; i < counts[c][k]; i++) out.push({ country: c, status: s, row: row++ }); });
  return out;
}

export const QUERIES: IndexQuery[] = [
  { id: 'lead', label: 'country = DE', sql: "where country = 'DE'", countries: ['DE'] },
  { id: 'both', label: 'country = DE and status = banned', sql: "where country = 'DE' and status = 'banned'", countries: ['DE'], statuses: ['banned'] },
  { id: 'in', label: 'country in (BR, US) and status = active', sql: "where country in ('BR', 'US') and status = 'active'", countries: ['BR', 'US'], statuses: ['active'] },
  { id: 'second', label: 'status = banned only', sql: "where status = 'banned'", statuses: ['banned'] },
  { id: 'order', label: 'order by country, status', sql: 'order by country, status', orderBy: true },
];

/** Maximal runs of consecutive matching entries. */
function runs(entries: Entry[], match: (e: Entry) => boolean): [number, number][] {
  const out: [number, number][] = [];
  entries.forEach((e, i) => {
    if (!match(e)) return;
    const last = out[out.length - 1];
    if (last && last[1] === i) last[1] = i + 1; else out.push([i, i + 1]);
  });
  return out;
}

export function usage(entries: Entry[], q: IndexQuery): Usage {
  const match = (e: Entry) => (!q.countries || q.countries.includes(e.country)) && (!q.statuses || q.statuses.includes(e.status));
  const ranges = runs(entries, match);
  const matched = entries.filter(match).length;
  if (q.orderBy) return { ranges: [[0, entries.length]], matched: entries.length, searches: 1, kind: 'ordered', note: 'The whole index, start to end, already in the requested order: no sort step is needed.' };
  if (q.countries && q.countries.length === 1) {
    return { ranges, matched, searches: 1, kind: 'slice', note: `One search finds the first matching entry; the matches sit next to each other, so the scan reads ${matched} entr${matched === 1 ? 'y' : 'ies'} and stops.` };
  }
  if (q.countries) {
    return { ranges, matched, searches: q.countries.length, kind: 'slices', note: `One search per value in the list (${q.countries.length}), each reading a small contiguous slice.` };
  }
  return {
    ranges, matched, searches: COUNTRIES.length, kind: 'skip',
    note: `The matches are scattered: one small slice inside each country. PostgreSQL 18 can skip scan: jump to each country in turn, about one search per distinct country (${COUNTRIES.length} here). Older versions would read the whole index or ignore it. Skip scan only pays off when the leading column has few distinct values.`,
  };
}
