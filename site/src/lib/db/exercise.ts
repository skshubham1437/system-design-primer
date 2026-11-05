// Running one attempt at a query-tuning exercise. Works with any engine that has exec() and query(),
// which is true of PGlite in Node (tests) and of the worker in the browser.
//
// Everything happens inside a transaction that is rolled back, so an attempt never changes the database:
//   1. run the exercise's setup, if any
//   2. compute a fingerprint of what the ORIGINAL query returns (the right answer, slowly)
//   3. run the learner's changes (for example CREATE INDEX, or ANALYZE)
//   4. explain the learner's query, executed, with buffers
//   5. fingerprint what the learner's query returns, and compare
import { evaluate, type Check, type CheckResult, type PlanNode } from './checks';

export interface Exercise {
  id: string;
  title: string;
  difficulty: 1 | 2 | 3;
  scenario: string;
  task: string;
  setup?: string;
  query: string;          // the original, slow query; its result is the reference
  ordered?: boolean;      // the order of rows matters (the query has an ORDER BY that the answer must keep)
  allowChanges?: boolean; // the learner may run statements (CREATE INDEX, ANALYZE…) before the query
  checks: Check[];
  hints: string[];
  solution: { changes?: string; query?: string };
  why: string;
  page?: string;
  reviewed?: boolean;
}

export interface Executor {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string): Promise<{ rows: T[] }>;
}

export interface Attempt { changes?: string; query: string }
export interface AttemptResult {
  passed: boolean;
  sameResult: boolean;
  rows: number;
  checks: CheckResult[];
  plan: PlanNode;
  planText: string[];
  /** Things the checker changed about the learner's statements before running them, to show beside the result. */
  notes?: string[];
  error?: string;
}

const strip = (sql: string) => sql.trim().replace(/;\s*$/, '');

/** Blank out comments and quoted text (keeping every position), so words inside them are not read as SQL. */
const codeOnly = (sql: string) =>
  sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'|"(?:[^"]|"")*"|\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1\$/g, (m) => ' '.repeat(m.length));

/** Statements that end the attempt's transaction, so the rollback afterwards could no longer undo the attempt. */
const ENDS_TRANSACTION = /^(begin|start\s+transaction|commit|end|abort|rollback(?!\s+to\b)|prepare\s+transaction|vacuum)\b/i;

/**
 * Make a learner's changes safe to run inside the attempt's transaction. Transaction control and VACUUM are
 * refused: a COMMIT would keep the change for every later attempt on the page. CONCURRENTLY, which cannot run
 * inside a transaction but is what the locks page recommends, is dropped with a note.
 */
export function prepareChanges(sql: string): { sql: string; notes: string[] } {
  const code = codeOnly(sql);
  for (const statement of code.split(';')) {
    const m = statement.trim().match(ENDS_TRANSACTION);
    if (m) throw new Error(`${m[1].toUpperCase().replace(/\s+/g, ' ')} is not allowed here. Each attempt runs inside a transaction that is rolled back afterwards, so the sample database stays the same for every attempt; leave out transaction control and VACUUM.`);
  }
  const cuts = [...code.matchAll(/\s+concurrently\b/gi)];
  if (!cuts.length) return { sql, notes: [] };
  let out = sql;
  for (const c of cuts.reverse()) out = out.slice(0, c.index) + out.slice(c.index + c[0].length);
  return { sql: out, notes: ['Ran without CONCURRENTLY: it cannot run inside the transaction that keeps each attempt from changing the database. The plan is the same either way; CONCURRENTLY only changes how the build locks the table.'] };
}

/** A fingerprint of a query's result. Unordered results are sorted first, so only the set of rows counts. */
export function fingerprintSql(query: string, ordered: boolean): string {
  const inner = strip(query);
  return ordered
    ? `select md5(coalesce(string_agg(t::text, E'\\n'), '')) as h, count(*)::int as n from (${inner}) t`
    : `select md5(coalesce(string_agg(t::text, E'\\n' order by t::text), '')) as h, count(*)::int as n from (${inner}) t`;
}

export async function runAttempt(db: Executor, ex: Exercise, attempt: Attempt): Promise<AttemptResult> {
  await db.exec('begin');
  try {
    if (ex.setup?.trim()) await db.exec(ex.setup);
    const ordered = !!ex.ordered;
    const want = (await db.query<{ h: string; n: number }>(fingerprintSql(ex.query, ordered))).rows[0];
    let notes: string[] = [];
    if (attempt.changes?.trim()) {
      if (!ex.allowChanges) throw new Error('This exercise asks you to change the query only.');
      const prepared = prepareChanges(attempt.changes);
      notes = prepared.notes;
      await db.exec(prepared.sql);
    }
    const q = strip(attempt.query);
    const json = (await db.query<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(`explain (analyze, buffers, format json) ${q}`)).rows[0]['QUERY PLAN'][0].Plan;
    const text = (await db.query<{ 'QUERY PLAN': string }>(`explain (analyze, buffers) ${q}`)).rows.map((r) => r['QUERY PLAN']);
    const got = (await db.query<{ h: string; n: number }>(fingerprintSql(q, ordered))).rows[0];
    const checks = evaluate(json, ex.checks);
    const sameResult = got.h === want.h;
    checks.push({ ok: sameResult, label: 'Returns the same rows as the original query', detail: sameResult ? `${got.n.toLocaleString('en-US')} rows, identical.` : `It returned ${got.n.toLocaleString('en-US')} rows; the original returns ${want.n.toLocaleString('en-US')}${got.n === want.n ? ', but not the same ones' : ''}${ordered ? ' (order matters here)' : ''}.` });
    return { passed: checks.every((c) => c.ok), sameResult, rows: got.n, checks, plan: json, planText: text, ...(notes.length ? { notes } : {}) };
  } finally {
    await db.exec('rollback');
  }
}
