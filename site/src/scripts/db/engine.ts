// The browser side of the sample database. Nothing here is loaded until a learner asks for the database,
// because the engine is a few megabytes. One database per tab; Stop and Reset throw it away and start fresh.
import type { PGliteWorker } from '@electric-sql/pglite/worker';

export interface Result { rows: Record<string, unknown>[]; fields: { name: string }[]; affectedRows?: number }
export interface Engine {
  version: string;
  /** Run one or more statements; returns the result of each. */
  exec(sql: string): Promise<Result[]>;
  /** Run one statement with parameters. */
  query(sql: string, params?: unknown[]): Promise<Result>;
}

/**
 * A query still running after this long is abandoned and the database discarded. PGlite ignores
 * statement_timeout, and a huge result (a cross join of two big tables) can exhaust the worker's memory,
 * so without this a page would wait forever. Real queries on the sample shop finish in well under a second.
 */
export const QUERY_LIMIT_MS = 30_000;

let starting: Promise<Engine> | null = null;
let worker: Worker | null = null;
const pending = new Set<(e: Error) => void>();

/** Wrap a call so that Stop can abandon it: a terminated worker never answers. */
function cancellable<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pending.add(reject);
    p.then(resolve, reject).finally(() => pending.delete(reject));
  });
}

/** Like `cancellable`, but gives up after QUERY_LIMIT_MS and throws the database away. */
function limited<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Stopped after ${QUERY_LIMIT_MS / 1000} seconds. The query ran too long or returned too many rows, so the database was discarded; it will be rebuilt when you run something.`));
      stopEngine();
    }, QUERY_LIMIT_MS);
  });
  return Promise.race([cancellable(p), late]).finally(() => clearTimeout(timer));
}

export const engineStarted = () => starting !== null;

export function startEngine(): Promise<Engine> {
  if (starting) return starting;
  starting = (async () => {
    const { PGliteWorker } = await import('@electric-sql/pglite/worker');
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker = w;
    // A worker that crashes (out of memory, a failed engine download) never answers; fail what is waiting.
    w.addEventListener('error', () => { if (worker === w) stopEngine('The database crashed and was discarded; it will be rebuilt when you run something.'); });
    // a unique id keeps each tab's database separate (PGlite would otherwise share one between tabs)
    const pg: PGliteWorker = new PGliteWorker(w, { id: `primer-${crypto.randomUUID()}` });
    await cancellable(pg.waitReady);
    const v = (await cancellable(pg.query<{ v: string }>('select version() as v'))).rows[0].v;
    return {
      version: v.slice(0, v.indexOf(')') + 1),
      exec: (sql) => limited(pg.exec(sql)) as Promise<Result[]>,
      query: (sql, params) => limited(pg.query(sql, params)) as Promise<Result>,
    };
  })();
  starting.catch(() => { starting = null; });
  return starting;
}

/** Stop whatever is running and discard the database. The next start builds a fresh one. */
export function stopEngine(why = 'Stopped. The database was discarded; it will be rebuilt when you run something.') {
  worker?.terminate();
  worker = null;
  starting = null;
  for (const reject of [...pending]) reject(new Error(why));
  pending.clear();
}
