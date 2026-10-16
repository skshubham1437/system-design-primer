// The recorded concurrency traces: they exist for every scenario, they are current, and replaying them makes sense.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { load as loadYaml } from 'js-yaml';
import { sessionsAt, locksAt, waitsAt, type Trace } from '../../src/lib/db/traces';

const SITE = path.resolve(__dirname, '../..');
const scenarios = loadYaml(fs.readFileSync(path.join(SITE, 'content/databases/concurrency-scenarios.yaml'), 'utf8')) as { id: string }[];
const trace = (id: string) => JSON.parse(fs.readFileSync(path.join(SITE, 'data/db-traces', `${id}.json`), 'utf8')) as Trace;

describe('recorded traces', () => {
  it('every scenario has a trace recorded from its current definition on PostgreSQL 18', () => {
    for (const sc of scenarios) {
      const t = trace(sc.id);
      expect(t.scenario, `${sc.id}: scenario changed, re-record with node scripts/record-traces.mjs`).toBe(crypto.createHash('sha1').update(JSON.stringify(sc)).digest('hex').slice(0, 16));
      expect(t.engine).toMatch(/^PostgreSQL 18\./);
    }
  });

  it('a blocked update waits for the holder, then finishes when it commits', () => {
    const t = trace('row-lock-wait');
    const waitIdx = t.events.findIndex((e) => e.status === 'waiting');
    expect(sessionsAt(t, waitIdx + 1).B.state).toBe('waiting');
    expect(waitsAt(t, waitIdx + 1)).toEqual([['B', 'A']]);
    const resumed = t.events.findIndex((e) => e.kind === 'resumed');
    expect(t.events[resumed]).toMatchObject({ session: 'B', status: 'ok' });
    expect(sessionsAt(t, t.events.length).B.state).toBe('idle');
  });

  it('a deadlock aborts exactly one side, which must then roll back', () => {
    const t = trace('deadlock');
    const victims = t.events.filter((e) => e.code === '40P01');
    expect(victims).toHaveLength(1);
    const at = t.events.indexOf(victims[0]) + 1;
    expect(sessionsAt(t, at)[victims[0].session].state).toBe('failed');
    expect(sessionsAt(t, t.events.length)[victims[0].session].state).toBe('idle');
  });

  it('in the lock queue, a plain read waits behind the migration, not behind the reader', () => {
    const t = trace('lock-queue');
    const cWait = t.events.findIndex((e) => e.session === 'C' && e.status === 'waiting');
    expect(waitsAt(t, cWait + 1)).toEqual(expect.arrayContaining([['B', 'A'], ['C', 'B']]));
    expect(locksAt(t, cWait + 1).find((l) => l.session === 'B' && !l.granted)?.mode).toBe('AccessExclusiveLock');
  });

  it('serializable aborts one of the two write-skew transactions; repeatable read refuses a conflicting update', () => {
    expect(trace('write-skew').events.filter((e) => e.code === '40001')).toHaveLength(1);
    expect(trace('repeatable-read').events.find((e) => e.status === 'error')?.error).toMatch(/could not serialize/);
  });

  it('the lost update really loses money, and FOR UPDATE keeps it', () => {
    expect(trace('lost-update').events.at(-1)!.rows).toEqual([{ balance: 130 }]);
    const fu = trace('select-for-update');
    expect(fu.events.find((e) => e.kind === 'resumed')!.rows).toEqual([{ balance: 150 }]);
  });
});
