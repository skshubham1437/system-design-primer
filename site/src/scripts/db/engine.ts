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

export const engineStarted = () => starting !== null;

export function startEngine(): Promise<Engine> {
  if (starting) return starting;
  starting = (async () => {
    const { PGliteWorker } = await import('@electric-sql/pglite/worker');
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    // a unique id keeps each tab's database separate (PGlite would otherwise share one between tabs)
    const pg: PGliteWorker = new PGliteWorker(worker, { id: `primer-${crypto.randomUUID()}` });
    await cancellable(pg.waitReady);
    const v = (await pg.query<{ v: string }>('select version() as v')).rows[0].v;
    return {
      version: v.slice(0, v.indexOf(')') + 1),
      exec: (sql) => cancellable(pg.exec(sql)) as Promise<Result[]>,
      query: (sql, params) => cancellable(pg.query(sql, params)) as Promise<Result>,
    };
  })();
  starting.catch(() => { starting = null; });
  return starting;
}

/** Stop whatever is running and discard the database. The next start builds a fresh one. */
export function stopEngine() {
  worker?.terminate();
  worker = null;
  starting = null;
  for (const reject of [...pending]) reject(new Error('Stopped. The database was discarded; it will be rebuilt when you run something.'));
  pending.clear();
}
