import { describe, expect, it, vi } from 'vitest';
import { countProgress, createStore, emptyDoc, migrateLegacy, needsBackupReminder, normalize, requestDurableStorage, STORE_KEY, totalProgress, type ProgressDoc, type StorageLike } from '../../src/lib/progress';

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
  };
}

const NOW = Date.UTC(2026, 5, 1, 12);

describe('basic behaviour', () => {
  it('starts empty and persists updates', () => {
    const storage = memoryStorage();
    const store = createStore({ storage, now: () => NOW });
    expect(store.get()).toEqual(emptyDoc());
    store.update((d) => { d.read['learn/cache/'] = { at: NOW, pct: 100 }; });
    expect(JSON.parse(storage.data.get(STORE_KEY)!).read['learn/cache/'].pct).toBe(100);
  });

  it('does not mutate the previous document when updating', () => {
    const store = createStore({ storage: memoryStorage() });
    const before = store.get();
    store.update((d) => { d.plan.last = 'long'; });
    expect(before.plan.last).toBeUndefined();
    expect(store.get().plan.last).toBe('long');
  });

  it('notifies subscribers and stops after unsubscribe', () => {
    const store = createStore({ storage: memoryStorage() });
    const cb = vi.fn();
    const off = store.subscribe(cb);
    store.update((d) => { d.plan.last = 'short'; });
    off();
    store.update((d) => { d.plan.last = 'long'; });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('a throwing subscriber does not stop the others', () => {
    const store = createStore({ storage: memoryStorage() });
    const ok = vi.fn();
    store.subscribe(() => { throw new Error('boom'); });
    store.subscribe(ok);
    store.update((d) => { d.plan.last = 'short'; });
    expect(ok).toHaveBeenCalled();
  });

  it('debounces writes and flushes on demand', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const store = createStore({ storage, debounceMs: 200 });
    store.update((d) => { d.plan.last = 'short'; });
    expect(storage.data.has(STORE_KEY)).toBe(false);
    store.flush();
    expect(storage.data.has(STORE_KEY)).toBe(true);
    vi.useRealTimers();
  });

  it('reloads changes made elsewhere (another tab)', () => {
    const storage = memoryStorage();
    const a = createStore({ storage });
    const b = createStore({ storage });
    a.update((d) => { d.plan.last = 'long'; });
    b.reload();
    expect(b.get().plan.last).toBe('long');
  });

  it('reset clears one section or everything', () => {
    const store = createStore({ storage: memoryStorage() });
    store.update((d) => { d.plan.last = 'long'; d.read['x/'] = { at: 1, pct: 50 }; });
    store.reset('plan');
    expect(store.get().plan.last).toBeUndefined();
    expect(store.get().read['x/']).toBeDefined();
    store.reset();
    expect(store.get()).toEqual(emptyDoc());
  });
});

describe('when storage misbehaves', () => {
  it('works in memory with no storage at all', () => {
    const store = createStore({ storage: null });
    store.update((d) => { d.plan.last = 'short'; });
    expect(store.get().plan.last).toBe('short');
    expect(store.isPersistent()).toBe(false);
  });

  it('falls back to memory when a write fails (quota or blocked)', () => {
    const storage = memoryStorage();
    storage.setItem = () => { throw new Error('QuotaExceededError'); };
    const store = createStore({ storage });
    expect(() => store.update((d) => { d.plan.last = 'short'; })).not.toThrow();
    expect(store.get().plan.last).toBe('short');
    expect(store.isPersistent()).toBe(false);
  });

  it('survives getItem throwing', () => {
    const storage = memoryStorage();
    storage.getItem = () => { throw new Error('SecurityError'); };
    expect(() => createStore({ storage })).not.toThrow();
  });

  it('keeps unreadable data under a recovery key instead of deleting it', () => {
    const storage = memoryStorage({ [STORE_KEY]: '{not json' });
    const store = createStore({ storage });
    expect(store.get()).toEqual(emptyDoc());
    expect(storage.data.get(`${STORE_KEY}:corrupt`)).toBe('{not json');
  });

  it('does not overwrite a document written by a newer version', () => {
    const newer = JSON.stringify({ ...emptyDoc(), version: 99, plan: { last: 'long', done: {} } });
    const storage = memoryStorage({ [STORE_KEY]: newer });
    const store = createStore({ storage });
    store.update((d) => { d.plan.last = 'short'; });
    expect(storage.data.get(STORE_KEY)).toBe(newer);
  });
});

describe('normalize', () => {
  it('drops malformed entries but keeps good ones', () => {
    const d = normalize({
      read: { good: { at: 5, pct: 250 }, bad: 'nope' },
      cards: { ok: { box: 9, due: 10, seen: 'x' }, broken: { box: 'a' } },
      plan: { last: 7, done: { short: [1, 'x', 2] } },
      quiz: { attempts: [{ id: 'a', score: 1, of: 2, at: 3 }, { id: 5 }], items: {} },
      settings: { newCardsPerDay: 5000 },
    });
    expect(d.read).toEqual({ good: { at: 5, pct: 100 } });
    expect(d.cards).toEqual({ ok: { box: 5, due: 10, seen: 0, lapses: 0 } });
    expect(d.plan).toEqual({ done: { short: [1, 2] } });
    expect(d.quiz.attempts).toHaveLength(1);
    expect(d.settings.newCardsPerDay).toBe(100);
  });

  it('returns an empty document for nonsense', () => {
    for (const bad of [null, 5, 'x', [], undefined]) expect(normalize(bad)).toEqual(emptyDoc());
  });
});

describe('import and export', () => {
  it('round-trips a document', () => {
    const a = createStore({ storage: memoryStorage() });
    a.update((d) => { d.plan.last = 'long'; d.cards.X = { box: 2, due: 5, seen: 3, lapses: 1 }; });
    const b = createStore({ storage: memoryStorage() });
    expect(b.importJson(a.exportJson())).toEqual({ ok: true });
    expect(b.get()).toEqual(a.get());
  });

  it('keeps every section through a save and a reload', () => {
    // normalize() runs on every write and copies only the sections it knows. A section added to ProgressDoc
    // but not to normalize() would be wiped on each save, so fill every section and check nothing is lost.
    const full: ProgressDoc = {
      version: 1,
      read: { 'dns/': { at: 1, pct: 40 } },
      plan: { last: 'long', done: { long: [0, 2] } },
      cards: { X: { box: 2, due: 5, seen: 3, lapses: 1 } },
      quiz: { attempts: [{ id: 'q', score: 3, of: 5, at: 2 }], items: { 'q-1': { box: 1, due: 9, seen: 1, lapses: 0 } } },
      solutions: { 'solutions/x/': { status: 'done', step: 'scale', notes: { a: 'b' }, rubric: { a: ['c'] } } },
      paths: { databases: { stage: 2 } },
      choosers: { db: { guided: 1, attempts: [{ score: 2, of: 3, at: 4 }] } },
      sessions: [{ id: 's', question: 'x', minutes: 45, notes: { a: 'b' }, at: 3 }],
      exercises: { ex: { attempts: 2, hints: 1, solved: 7, revealed: true } },
      settings: { newCardsPerDay: 20 },
      daily: { day: 86_400_000, newCards: 4 },
      backup: { exportedAt: 5, changedAt: 6 },
    };
    const empty = emptyDoc();
    for (const k of Object.keys(empty) as (keyof ProgressDoc)[]) {
      if (k !== 'version') expect(full[k], `fill section "${k}" in this test`).not.toEqual(empty[k]);
    }
    const storage = memoryStorage();
    const a = createStore({ storage, now: () => 6 });
    a.update((d) => { Object.assign(d, structuredClone(full)); });
    expect(a.get()).toEqual(full);
    expect(createStore({ storage }).get()).toEqual(full);
  });

  it('rejects bad input and leaves the existing data alone', () => {
    const store = createStore({ storage: memoryStorage() });
    store.update((d) => { d.plan.last = 'long'; });
    expect(store.importJson('nope')).toMatchObject({ ok: false });
    expect(store.importJson('{"hello":1}')).toMatchObject({ ok: false });
    expect(store.importJson(JSON.stringify({ version: 99 }))).toMatchObject({ ok: false });
    expect(store.get().plan.last).toBe('long');
  });

  it('keeps a backup of what was there before an import, and can restore it', () => {
    const storage = memoryStorage();
    const store = createStore({ storage });
    store.update((d) => { d.plan.last = 'long'; });
    store.importJson(JSON.stringify({ ...emptyDoc(), plan: { last: 'short', done: {} } }));
    expect(store.get().plan.last).toBe('short');
    expect(store.restoreBackup()).toBe(true);
    expect(store.get().plan.last).toBe('long');
  });
});

describe('migration from the old keys', () => {
  const legacy = {
    'primer:plan:v1': JSON.stringify({ done: { short: [0, 2] }, last: 'medium' }),
    'primer:cards:v1': JSON.stringify({ known: ['Cache-aside', 'Sharding'] }),
  };

  it('returns null when there is nothing to migrate', () => {
    expect(migrateLegacy(memoryStorage(), NOW)).toBeNull();
  });

  it('carries over the planner and puts known cards in box 3', () => {
    const d = migrateLegacy(memoryStorage(legacy), NOW)!;
    expect(d.plan).toEqual({ last: 'medium', done: { short: [0, 2] } });
    expect(Object.keys(d.cards)).toEqual(['Cache-aside', 'Sharding']);
    expect(d.cards['Cache-aside'].box).toBe(3);
    expect(d.cards['Cache-aside'].due).toBeGreaterThan(NOW);
  });

  it('creates the new document on first load and removes the old keys only after writing it', () => {
    const storage = memoryStorage(legacy);
    const store = createStore({ storage, now: () => NOW });
    expect(store.get().plan.last).toBe('medium');
    expect(storage.data.has(STORE_KEY)).toBe(true);
    expect(storage.data.has('primer:plan:v1')).toBe(false);
    expect(storage.data.has('primer:cards:v1')).toBe(false);
  });

  it('keeps the old keys if the new document cannot be written', () => {
    const storage = memoryStorage(legacy);
    storage.setItem = () => { throw new Error('QuotaExceededError'); };
    const store = createStore({ storage, now: () => NOW });
    expect(store.get().plan.last).toBe('medium'); // still usable in memory
    expect(storage.data.has('primer:plan:v1')).toBe(true);
  });

  it('survives garbage in the old keys', () => {
    const storage = memoryStorage({ 'primer:plan:v1': '{{{', 'primer:cards:v1': '[]' });
    expect(() => createStore({ storage })).not.toThrow();
  });

  it('does not migrate again once the new document exists', () => {
    const storage = memoryStorage({ [STORE_KEY]: JSON.stringify(emptyDoc()), ...legacy });
    const store = createStore({ storage });
    expect(store.get().plan.last).toBeUndefined();
  });
});

/** Storage whose writes to the main key can be switched off, like a full or locked localStorage. */
function flakyStorage(initial: Record<string, string> = {}) {
  const s = memoryStorage(initial);
  const real = s.setItem;
  const control = { failing: false, failAll: false };
  s.setItem = (k, v) => {
    if (control.failAll || (control.failing && k === STORE_KEY)) throw new Error('QuotaExceededError');
    real(k, v);
  };
  return Object.assign(s, { control });
}
const stored = (s: { data: Map<string, string> }) => JSON.parse(s.data.get(STORE_KEY)!);
const CARD = { box: 1, due: 5, seen: 1, lapses: 0 };

describe('failed saves', () => {
  it('tries again on the next change, and that write carries the earlier change too', () => {
    const storage = flakyStorage();
    const store = createStore({ storage });
    storage.control.failing = true;
    store.update((d) => { d.plan.last = 'short'; });
    expect(store.isPersistent()).toBe(false);
    expect(store.saveProblem()).toBe('write-failed');

    storage.control.failing = false;
    store.update((d) => { d.read['x/'] = { at: 1, pct: 50 }; });
    expect(store.isPersistent()).toBe(true);
    expect(store.saveProblem()).toBeNull();
    expect(stored(storage).plan.last).toBe('short');
    expect(stored(storage).read['x/'].pct).toBe(50);
  });

  it('tries again when the page is hidden, without waiting for another change', () => {
    const storage = flakyStorage();
    const store = createStore({ storage });
    storage.control.failing = true;
    store.update((d) => { d.plan.last = 'short'; });
    storage.control.failing = false;
    store.flush();
    expect(stored(storage).plan.last).toBe('short');
    expect(store.hasUnsavedChanges()).toBe(false);
  });

  it('tells listeners when changes stop being saved and when they start again, once each', () => {
    const storage = flakyStorage();
    const store = createStore({ storage });
    const seen: boolean[] = [];
    store.onSaveStatus(() => seen.push(store.hasUnsavedChanges()));

    store.update((d) => { d.plan.last = 'short'; }); // saved: nothing to report
    expect(seen).toEqual([]);
    storage.control.failing = true;
    store.update((d) => { d.plan.last = 'long'; });
    store.update((d) => { d.plan.last = 'medium'; });
    expect(seen).toEqual([true]);
    storage.control.failing = false;
    store.update((d) => { d.plan.last = 'short'; });
    expect(seen).toEqual([true, false]);
  });

  it('does not report unsaved changes while a debounced write is simply waiting', () => {
    vi.useFakeTimers();
    const store = createStore({ storage: memoryStorage(), debounceMs: 150 });
    store.update((d) => { d.plan.last = 'short'; });
    expect(store.hasUnsavedChanges()).toBe(false);
    vi.runAllTimers();
    expect(store.hasUnsavedChanges()).toBe(false);
    vi.useRealTimers();
  });

  it('reports unsaved changes with no storage at all, but only once something has changed', () => {
    const store = createStore({ storage: null });
    expect(store.saveProblem()).toBe('no-storage');
    expect(store.hasUnsavedChanges()).toBe(false);
    store.update((d) => { d.plan.last = 'short'; });
    expect(store.hasUnsavedChanges()).toBe(true);
  });

  it('stays read-only for a document from a newer version, change after change', () => {
    const newer = JSON.stringify({ ...emptyDoc(), version: 99, plan: { last: 'long', done: {} } });
    const storage = memoryStorage({ [STORE_KEY]: newer });
    const store = createStore({ storage });
    store.update((d) => { d.plan.last = 'short'; });
    store.update((d) => { d.plan.last = 'medium'; });
    store.flush();
    expect(store.saveProblem()).toBe('newer-version');
    expect(storage.data.get(STORE_KEY)).toBe(newer);
  });

  it('never writes over a document it could not read, and merges once it can', () => {
    const good = JSON.stringify({ ...emptyDoc(), plan: { last: 'long', done: {} } });
    const storage = memoryStorage({ [STORE_KEY]: good });
    const realGet = storage.getItem;
    storage.getItem = () => { throw new Error('SecurityError'); };
    const store = createStore({ storage });
    store.update((d) => { d.read['x/'] = { at: 1, pct: 50 }; });
    expect(store.saveProblem()).toBe('unreadable');
    expect(storage.data.get(STORE_KEY)).toBe(good);

    storage.getItem = realGet;
    store.update((d) => { d.read['y/'] = { at: 1, pct: 60 }; });
    expect(store.isPersistent()).toBe(true);
    expect(stored(storage).plan.last).toBe('long');
    expect(Object.keys(stored(storage).read).sort()).toEqual(['x/', 'y/']);
  });

  it('keeps what it holds when a reload cannot read storage', () => {
    const storage = memoryStorage();
    const store = createStore({ storage });
    store.update((d) => { d.plan.last = 'long'; });
    storage.getItem = () => { throw new Error('SecurityError'); };
    store.reload();
    expect(store.get().plan.last).toBe('long');
  });
});

describe('importing when saving fails', () => {
  const file = JSON.stringify({ ...emptyDoc(), plan: { last: 'short', done: {} } });

  it('reports failure and changes nothing, including the existing backup', () => {
    const storage = flakyStorage();
    const store = createStore({ storage });
    store.update((d) => { d.plan.last = 'long'; });
    store.importJson(JSON.stringify({ ...emptyDoc(), plan: { last: 'medium', done: {} } }));
    const backupBefore = storage.data.get(`${STORE_KEY}:backup`);

    storage.control.failing = true;
    const res = store.importJson(file);
    expect(res.ok).toBe(false);
    expect(store.get().plan.last).toBe('medium');
    expect(storage.data.get(`${STORE_KEY}:backup`)).toBe(backupBefore);
  });

  it('removes the backup it just made when there was none before', () => {
    const storage = flakyStorage();
    const store = createStore({ storage });
    store.update((d) => { d.plan.last = 'long'; });
    storage.control.failing = true;
    expect(store.importJson(file).ok).toBe(false);
    expect(store.hasBackup()).toBe(false);
  });

  it('reports failure with no storage, and in a read-only tab', () => {
    expect(createStore({ storage: null }).importJson(file).ok).toBe(false);
    const newer = JSON.stringify({ ...emptyDoc(), version: 99 });
    const storage = memoryStorage({ [STORE_KEY]: newer });
    expect(createStore({ storage }).importJson(file).ok).toBe(false);
    expect(storage.data.get(STORE_KEY)).toBe(newer);
  });

  it('says so when the import worked but no backup could be kept', () => {
    const storage = flakyStorage();
    const store = createStore({ storage });
    store.update((d) => { d.plan.last = 'long'; });
    const real = storage.setItem;
    storage.setItem = (k, v) => { if (k.endsWith(':backup')) throw new Error('QuotaExceededError'); real(k, v); };
    expect(store.importJson(file)).toEqual({ ok: true, noBackup: true });
    expect(store.get().plan.last).toBe('short');
  });

  it('the backup includes a change that was still waiting to be written', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const store = createStore({ storage, debounceMs: 150 });
    store.update((d) => { d.plan.last = 'long'; });
    vi.runAllTimers();
    store.update((d) => { d.plan.last = 'medium'; });
    store.importJson(file);
    expect(store.restoreBackup()).toBe(true);
    expect(store.get().plan.last).toBe('medium');
    vi.useRealTimers();
  });

  it('restoring a backup reports failure when it cannot be written', () => {
    const storage = flakyStorage();
    const store = createStore({ storage });
    store.update((d) => { d.plan.last = 'long'; });
    store.importJson(file);
    storage.control.failing = true;
    expect(store.restoreBackup()).toBe(false);
    expect(store.get().plan.last).toBe('short');
  });
});

describe('previewing an import', () => {
  it('counts what is here and what is in the file', () => {
    const store = createStore({ storage: memoryStorage() });
    store.update((d) => { d.cards.A = CARD; d.read['x/'] = { at: 1, pct: 100 }; });
    const file = JSON.stringify({ ...emptyDoc(), cards: { A: CARD, B: CARD, C: CARD }, plan: { done: { short: [0, 1] } } });
    const p = store.previewImport(file);
    if (!p.ok) throw new Error(p.error);
    expect(p.current).toMatchObject({ cards: 1, pages: 1, planner: 0 });
    expect(p.incoming).toMatchObject({ cards: 3, pages: 0, planner: 2 });
    expect(store.get().cards.B).toBeUndefined(); // a preview changes nothing
  });

  it('rejects the same files an import rejects', () => {
    const store = createStore({ storage: memoryStorage() });
    expect(store.previewImport('nope').ok).toBe(false);
    expect(store.previewImport('{"hello":1}').ok).toBe(false);
    expect(store.previewImport(JSON.stringify({ version: 99 })).ok).toBe(false);
  });
});

describe('sections this code does not know about', () => {
  const withFuture = () => JSON.stringify({ ...emptyDoc(), future: { streak: 12 }, plan: { last: 'long', done: {} } });

  it('normalize keeps them', () => {
    expect(normalize({ version: 1, future: { streak: 12 }, also: [1, 2] })).toMatchObject({ future: { streak: 12 }, also: [1, 2] });
  });

  it('survive an update, a reload, an export and an import', () => {
    const storage = memoryStorage({ [STORE_KEY]: withFuture() });
    const store = createStore({ storage });
    store.update((d) => { d.plan.last = 'short'; });
    expect(stored(storage).future).toEqual({ streak: 12 });
    store.reload();
    expect(JSON.parse(store.exportJson()).future).toEqual({ streak: 12 });

    const other = memoryStorage();
    expect(createStore({ storage: other }).importJson(store.exportJson()).ok).toBe(true);
    expect(stored(other).future).toEqual({ streak: 12 });
    expect(stored(other).plan.last).toBe('short');
  });

  it('survive a section reset, and go only with Reset everything', () => {
    const storage = memoryStorage({ [STORE_KEY]: withFuture() });
    const store = createStore({ storage });
    store.reset('plan');
    expect(stored(storage).future).toEqual({ streak: 12 });
    store.reset();
    expect(stored(storage).future).toBeUndefined();
  });

  it('cannot change the prototype of the document', () => {
    const d = normalize(JSON.parse('{"version":1,"__proto__":{"polluted":true}}')) as unknown as Record<string, unknown>;
    expect(d.polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('a change pending when another tab saves', () => {
  it('a storage event inside the save delay keeps both changes', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const mine = createStore({ storage, debounceMs: 150 });
    const other = createStore({ storage });

    mine.update((d) => { d.cards.Mine = CARD; });     // waiting to be written
    other.update((d) => { d.cards.Theirs = CARD; });  // the other tab gets there first
    mine.reload();                                     // what the storage event does

    expect(Object.keys(mine.get().cards).sort()).toEqual(['Mine', 'Theirs']); // on screen straight away
    expect(Object.keys(stored(storage).cards)).toEqual(['Theirs']);           // and not yet written
    vi.advanceTimersByTime(150);
    expect(Object.keys(stored(storage).cards).sort()).toEqual(['Mine', 'Theirs']);
    vi.useRealTimers();
  });

  it('keeps both even if the storage event has not arrived when the write happens', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const mine = createStore({ storage, debounceMs: 150 });
    const other = createStore({ storage });
    mine.update((d) => { d.cards.Mine = CARD; });
    other.update((d) => { d.cards.Theirs = CARD; });
    vi.advanceTimersByTime(150);
    expect(Object.keys(stored(storage).cards).sort()).toEqual(['Mine', 'Theirs']);
    expect(Object.keys(mine.get().cards).sort()).toEqual(['Mine', 'Theirs']);
    vi.useRealTimers();
  });

  it('a stale tab with no storage event at all does not overwrite the other tab', () => {
    const storage = memoryStorage();
    const stale = createStore({ storage });
    const other = createStore({ storage });
    other.update((d) => { d.plan.last = 'long'; });
    stale.update((d) => { d.read['x/'] = { at: 1, pct: 50 }; }); // writes at once, never reloaded
    expect(stored(storage).plan.last).toBe('long');
    expect(stored(storage).read['x/'].pct).toBe(50);
  });

  it('counters add up rather than one tab winning', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const mine = createStore({ storage, debounceMs: 150 });
    const other = createStore({ storage });
    mine.update((d) => { d.daily = { day: 1, newCards: d.daily.newCards + 1 }; });
    other.update((d) => { d.daily = { day: 1, newCards: d.daily.newCards + 1 }; });
    mine.reload();
    vi.advanceTimersByTime(150);
    expect(stored(storage).daily.newCards).toBe(2);
    vi.useRealTimers();
  });

  it('a change that was written is not applied a second time by a later reload', () => {
    const storage = memoryStorage();
    const store = createStore({ storage });
    store.update((d) => { d.daily = { day: 1, newCards: d.daily.newCards + 1 }; });
    store.reload();
    expect(store.get().daily.newCards).toBe(1);
  });

  it('a pending Reset everything still clears what the other tab saved', () => {
    const storage = flakyStorage();
    const mine = createStore({ storage });
    storage.control.failing = true;
    mine.reset(); // cannot be written yet
    storage.control.failing = false;
    storage.data.set(STORE_KEY, JSON.stringify({ ...emptyDoc(), plan: { last: 'long', done: {} } }));
    mine.flush();
    expect(stored(storage).plan.last).toBeUndefined();
  });

  it('a change that throws when replayed does not take the others with it', () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const mine = createStore({ storage, debounceMs: 150 });
    const other = createStore({ storage });
    mine.update((d) => { if (Object.keys(d.cards).length) throw new Error('boom'); d.plan.last = 'long'; });
    mine.update((d) => { d.read['x/'] = { at: 1, pct: 50 }; });
    other.update((d) => { d.cards.Theirs = CARD; });
    expect(() => mine.reload()).not.toThrow();
    expect(mine.get().read['x/'].pct).toBe(50);
    vi.useRealTimers();
  });
});

describe('a stored value that is not an object', () => {
  it.each(['[1,2,3]', '5', 'null', '"text"', 'true'])('keeps %s under the recovery key', (raw) => {
    const storage = memoryStorage({ [STORE_KEY]: raw });
    const store = createStore({ storage });
    expect(store.get()).toEqual(emptyDoc());
    expect(storage.data.get(`${STORE_KEY}:corrupt`)).toBe(raw);
    store.update((d) => { d.plan.last = 'long'; });
    expect(storage.data.get(`${STORE_KEY}:corrupt`)).toBe(raw); // still there after the next save
    expect(stored(storage).plan.last).toBe('long');
  });

  it('will not overwrite the only copy if the recovery key cannot be written', () => {
    const storage = memoryStorage({ [STORE_KEY]: '{not json' });
    const real = storage.setItem;
    let recoveryFull = true;
    storage.setItem = (k, v) => { if (recoveryFull && k.endsWith(':corrupt')) throw new Error('QuotaExceededError'); real(k, v); };
    const store = createStore({ storage });
    store.update((d) => { d.plan.last = 'long'; });
    expect(storage.data.get(STORE_KEY)).toBe('{not json');

    recoveryFull = false;
    store.update((d) => { d.plan.last = 'short'; });
    expect(storage.data.get(`${STORE_KEY}:corrupt`)).toBe('{not json');
    expect(stored(storage).plan.last).toBe('short');
  });
});

describe('the backup reminder', () => {
  const DAY = 86_400_000;
  const withItems = (n: number, backup: ProgressDoc['backup'] = {}): ProgressDoc => {
    const d = emptyDoc();
    for (let i = 0; i < n; i++) d.cards[`c${i}`] = CARD;
    d.backup = backup;
    return d;
  };

  it('counts what would be lost, across sections', () => {
    const d = withItems(2);
    d.cards.unseen = { box: 0, due: 1, seen: 0, lapses: 0 };
    d.read['x/'] = { at: 1, pct: 40 };
    d.plan.done.short = [0, 1, 2];
    d.quiz.attempts.push({ id: 'q', score: 1, of: 2, at: 3 });
    d.solutions['s/'] = { status: 'attempted' };
    d.exercises.e = { attempts: 1, hints: 0 };
    d.choosers.c = { guided: 1, attempts: [] };
    d.paths['scaling-story'] = { stage: 2 };
    const c = countProgress(d);
    expect(c).toMatchObject({ cards: 2, pages: 1, planner: 3, quizzes: 1, solutions: 1, exercises: 1, choosers: 1, paths: 1 });
    expect(totalProgress(c)).toBe(11);
  });

  it('stays quiet until there is something meaningful to lose', () => {
    expect(needsBackupReminder(withItems(9), NOW)).toBe(false);
    expect(needsBackupReminder(withItems(10), NOW)).toBe(true);
  });

  it('stays quiet after an export until there are new changes and a week has passed', () => {
    const exportedAt = NOW - 30 * DAY;
    expect(needsBackupReminder(withItems(20, { exportedAt, changedAt: exportedAt - 1 }), NOW)).toBe(false); // nothing new
    expect(needsBackupReminder(withItems(20, { exportedAt, changedAt: exportedAt + 1 }), NOW)).toBe(true);
    const recent = NOW - 6 * DAY;
    expect(needsBackupReminder(withItems(20, { exportedAt: recent, changedAt: NOW }), NOW)).toBe(false);
    expect(needsBackupReminder(withItems(20, { exportedAt: NOW - 7 * DAY, changedAt: NOW }), NOW)).toBe(true);
  });

  it('marking an export is saved in the document and in the exported file', () => {
    const storage = memoryStorage();
    const store = createStore({ storage, now: () => NOW });
    store.update((d) => { d.cards.A = CARD; });
    store.markExported();
    expect(stored(storage).backup.exportedAt).toBe(NOW);
    expect(JSON.parse(store.exportJson()).backup.exportedAt).toBe(NOW);
  });

  it('a change to what you have learned is stamped, a settings change is not', () => {
    let t = NOW;
    const store = createStore({ storage: memoryStorage(), now: () => t });
    store.update((d) => { d.settings.newCardsPerDay = 20; });
    expect(store.get().backup.changedAt).toBeUndefined();
    t += 1;
    store.update((d) => { d.cards.A = CARD; });
    expect(store.get().backup.changedAt).toBe(t);
    t += 1;
    store.markExported();
    expect(store.get().backup.changedAt).toBe(t - 1);
  });

  it('an import keeps the export date in the file, so an old file does not pass as a fresh backup', () => {
    const store = createStore({ storage: memoryStorage(), now: () => NOW });
    store.importJson(JSON.stringify({ ...withItems(12), backup: { exportedAt: NOW - 30 * DAY, changedAt: NOW - 31 * DAY } }));
    expect(store.get().backup.exportedAt).toBe(NOW - 30 * DAY);
    expect(needsBackupReminder(store.get(), NOW)).toBe(false);
    store.update((d) => { d.cards.New = CARD; });
    expect(needsBackupReminder(store.get(), NOW)).toBe(true);
  });
});

describe('asking the browser to keep the data', () => {
  it('asks once per browser, and a refusal or an error is not a problem', async () => {
    const storage = memoryStorage();
    const persist = vi.fn(async () => false);
    requestDurableStorage(storage, { persist });
    requestDurableStorage(storage, { persist });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(() => requestDurableStorage(memoryStorage(), { persist: () => Promise.reject(new Error('no')) })).not.toThrow();
    expect(() => requestDurableStorage(memoryStorage(), { persist: () => { throw new Error('no'); } })).not.toThrow();
  });

  it('does nothing where the API or storage is missing', () => {
    expect(() => requestDurableStorage(memoryStorage(), undefined)).not.toThrow();
    const persist = vi.fn(async () => true);
    requestDurableStorage(null, { persist });
    expect(persist).not.toHaveBeenCalled();
  });

  it('waits to ask until it can remember having asked', () => {
    const storage = flakyStorage();
    storage.control.failAll = true;
    const persist = vi.fn(async () => true);
    requestDurableStorage(storage, { persist });
    expect(persist).not.toHaveBeenCalled();
  });
});

describe('exercise progress', () => {
  it('keeps well-formed exercise records and drops broken ones', async () => {
    const { normalize } = await import('../../src/lib/progress');
    const d = normalize({ exercises: { a: { attempts: 3, hints: 1, solved: 5, revealed: true }, b: { attempts: 'x' }, c: { attempts: 1.6 } } });
    expect(d.exercises).toEqual({ a: { attempts: 3, hints: 1, solved: 5, revealed: true }, c: { attempts: 2, hints: 0 } });
  });
});
