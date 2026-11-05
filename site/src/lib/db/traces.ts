// Replaying a recorded concurrency trace (data/db-traces/*.json, made by scripts/record-traces.mjs against a real
// PostgreSQL server). Pure functions: the state of every session, and the locks, at any point of the replay.

export interface TraceLock { session: string; type: string; mode: string; granted: boolean; on: string; blockedBy: string[] }
export interface TraceEvent {
  at: number;
  step?: number;
  session: string;
  kind: 'statement' | 'resumed';
  sql: string;
  note?: string;
  status: 'ok' | 'waiting' | 'error';
  error?: string;
  code?: string;
  command?: string;
  rowCount?: number | null;
  rows?: Record<string, unknown>[];
  locks?: TraceLock[];
}
export interface Trace { id: string; title: string; engine: string; recorded: string; scenario: string; sessions: string[]; setup: string; events: TraceEvent[] }

export type SessionState = 'idle' | 'in transaction' | 'waiting' | 'failed';
export interface SessionView { state: SessionState; last?: TraceEvent; waitingFor: string[] }

const starts = (sql: string) => /^\s*(begin|start\s+transaction)\b/i.test(sql);
const ends = (sql: string) => /^\s*(commit|rollback|end|abort)\b/i.test(sql);

/** State of each session after the first `count` events have happened. */
export function sessionsAt(trace: Trace, count: number): Record<string, SessionView> {
  const inTx: Record<string, boolean> = {};
  const view: Record<string, SessionView> = Object.fromEntries(trace.sessions.map((s) => [s, { state: 'idle' as SessionState, waitingFor: [] }]));
  for (const e of trace.events.slice(0, count)) {
    const v = view[e.session];
    v.last = e;
    v.waitingFor = [];
    if (e.status === 'waiting') {
      v.state = 'waiting';
      v.waitingFor = (e.locks ?? []).filter((l) => l.session === e.session && !l.granted).flatMap((l) => l.blockedBy);
      continue;
    }
    if (e.status === 'error') { v.state = inTx[e.session] ? 'failed' : 'idle'; continue; }
    if (starts(e.sql)) inTx[e.session] = true;
    if (ends(e.sql)) inTx[e.session] = false;
    v.state = inTx[e.session] ? 'in transaction' : 'idle';
  }
  return view;
}

/** The most recent lock snapshot taken at or before the first `count` events. */
export function locksAt(trace: Trace, count: number): TraceLock[] {
  for (let i = Math.min(count, trace.events.length) - 1; i >= 0; i--) if (trace.events[i].locks) return trace.events[i].locks!;
  return [];
}

/** Pairs [waiter, holder] at that moment, from the lock snapshot. */
export const waitsAt = (trace: Trace, count: number): [string, string][] =>
  locksAt(trace, count).filter((l) => !l.granted).flatMap((l) => l.blockedBy.map((b) => [l.session, b] as [string, string]));
