import { describe, expect, it, vi } from 'vitest';
import { createStore, emptyDoc, migrateLegacy, normalize, STORE_KEY, type StorageLike } from '../../src/lib/progress';

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

describe('exercise progress', () => {
  it('keeps well-formed exercise records and drops broken ones', async () => {
    const { normalize } = await import('../../src/lib/progress');
    const d = normalize({ exercises: { a: { attempts: 3, hints: 1, solved: 5, revealed: true }, b: { attempts: 'x' }, c: { attempts: 1.6 } } });
    expect(d.exercises).toEqual({ a: { attempts: 3, hints: 1, solved: 5, revealed: true }, c: { attempts: 2, hints: 0 } });
  });
});
