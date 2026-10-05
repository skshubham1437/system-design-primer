// One versioned, exportable store for everything a learner does on the site.
// Pure of the DOM except for an optional browser adapter at the bottom, so the logic is unit tested.
//
// Guarantees:
//  - corrupt or unreadable data never throws and never silently destroys a good copy
//  - if storage is unavailable (private mode, blocked, full) the app keeps working in memory
//  - importing validates first and keeps the previous document as a backup

import { newItem, type SrsItem } from './srs';

export const STORE_KEY = 'primer:v1';
export const VERSION = 1;

export interface ReadMark { at: number; pct: number }
export interface QuizAttempt { id: string; score: number; of: number; at: number }
export interface SolutionState { status: 'attempted' | 'done'; step?: string; notes?: Record<string, string>; rubric?: Record<string, string[]> }
export interface Session { id: string; question: string; minutes: number; notes: Record<string, string>; at: number }

export interface ProgressDoc {
  version: number;
  read: Record<string, ReadMark>;
  plan: { last?: string; done: Record<string, number[]> };
  cards: Record<string, SrsItem>;
  quiz: { attempts: QuizAttempt[]; items: Record<string, SrsItem> };
  solutions: Record<string, SolutionState>;
  paths: Record<string, { stage: number }>;
  sessions: Session[];
  settings: { newCardsPerDay: number };
  /** New flashcards introduced on `day` (local midnight), to enforce the daily limit. */
  daily: { day: number; newCards: number };
}

export type Section = Exclude<keyof ProgressDoc, 'version'>;

export const emptyDoc = (): ProgressDoc => ({
  version: VERSION,
  read: {},
  plan: { done: {} },
  cards: {},
  quiz: { attempts: [], items: {} },
  solutions: {},
  paths: {},
  sessions: [],
  settings: { newCardsPerDay: 10 },
  daily: { day: 0, newCards: 0 },
});

/* ------------------------------------------------------------ validation */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function srsItem(v: unknown): SrsItem | undefined {
  if (!isObj(v) || !isNum(v.box) || !isNum(v.due)) return undefined;
  return { box: Math.min(5, Math.max(0, Math.round(v.box))), due: v.due, seen: isNum(v.seen) ? v.seen : 0, lapses: isNum(v.lapses) ? v.lapses : 0 };
}
function mapOf<T>(v: unknown, f: (x: unknown) => T | undefined): Record<string, T> {
  const out: Record<string, T> = {};
  if (isObj(v)) for (const [k, x] of Object.entries(v)) { const y = f(x); if (y !== undefined) out[k] = y; }
  return out;
}

/** Keep what is well formed, drop what is not. Never throws. */
export function normalize(raw: unknown): ProgressDoc {
  const d = emptyDoc();
  if (!isObj(raw)) return d;
  d.read = mapOf(raw.read, (x) => (isObj(x) && isNum(x.at) ? { at: x.at, pct: isNum(x.pct) ? Math.min(100, Math.max(0, x.pct)) : 100 } : undefined));
  if (isObj(raw.plan)) {
    if (typeof raw.plan.last === 'string') d.plan.last = raw.plan.last;
    d.plan.done = mapOf(raw.plan.done, (x) => (Array.isArray(x) ? x.filter(isNum) : undefined));
  }
  d.cards = mapOf(raw.cards, srsItem);
  if (isObj(raw.quiz)) {
    if (Array.isArray(raw.quiz.attempts)) d.quiz.attempts = raw.quiz.attempts.filter((a): a is QuizAttempt => isObj(a) && typeof a.id === 'string' && isNum(a.score) && isNum(a.of) && isNum(a.at));
    d.quiz.items = mapOf(raw.quiz.items, srsItem);
  }
  d.solutions = mapOf(raw.solutions, (x) => (isObj(x) && (x.status === 'attempted' || x.status === 'done') ? (x as unknown as SolutionState) : undefined));
  d.paths = mapOf(raw.paths, (x) => (isObj(x) && isNum(x.stage) ? { stage: x.stage } : undefined));
  if (Array.isArray(raw.sessions)) d.sessions = raw.sessions.filter((s): s is Session => isObj(s) && typeof s.id === 'string');
  if (isObj(raw.settings) && isNum(raw.settings.newCardsPerDay)) d.settings.newCardsPerDay = Math.min(100, Math.max(0, Math.round(raw.settings.newCardsPerDay)));
  if (isObj(raw.daily) && isNum(raw.daily.day) && isNum(raw.daily.newCards)) d.daily = { day: raw.daily.day, newCards: Math.max(0, Math.round(raw.daily.newCards)) };
  return d;
}

/* ------------------------------------------------------------ legacy migration */

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

const LEGACY_PLAN = 'primer:plan:v1';
const LEGACY_CARDS = 'primer:cards:v1';

/**
 * Read the keys used before the unified store existed. Returns the migrated document, or null if there is
 * nothing to migrate. Previously "known" flashcards land in box 3, so no one loses progress.
 */
export function migrateLegacy(storage: StorageLike, now: number): ProgressDoc | null {
  const read = (k: string): unknown => { try { const v = storage.getItem(k); return v ? JSON.parse(v) : undefined; } catch { return undefined; } };
  const plan = read(LEGACY_PLAN);
  const cards = read(LEGACY_CARDS);
  if (plan === undefined && cards === undefined) return null;
  const d = emptyDoc();
  if (isObj(plan)) {
    if (typeof plan.last === 'string') d.plan.last = plan.last;
    d.plan.done = mapOf(plan.done, (x) => (Array.isArray(x) ? x.filter(isNum) : undefined));
  }
  if (isObj(cards) && Array.isArray(cards.known)) {
    const day = 86_400_000;
    for (const title of cards.known) if (typeof title === 'string') d.cards[title] = { box: 3, due: now + 7 * day, seen: 1, lapses: 0 };
  }
  return d;
}

/* ------------------------------------------------------------ the store */

export type Listener = (doc: ProgressDoc) => void;
export type ImportResult = { ok: true } | { ok: false; error: string };

export interface StoreOptions {
  storage: StorageLike | null;
  key?: string;
  /** Wait this long after the last change before writing; 0 writes immediately. */
  debounceMs?: number;
  now?: () => number;
}

export function createStore({ storage, key = STORE_KEY, debounceMs = 0, now = Date.now }: StoreOptions) {
  const listeners = new Set<Listener>();
  let persistent = storage !== null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let doc: ProgressDoc = emptyDoc();
  doc = load();

  function readRaw(): string | null {
    try { return storage ? storage.getItem(key) : null; } catch { persistent = false; return null; }
  }

  function load(): ProgressDoc {
    const raw = readRaw();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (isObj(parsed) && isNum(parsed.version) && parsed.version > VERSION) {
          // Written by a newer version of the site. Do not touch it; work in memory.
          persistent = false;
          return normalize(parsed);
        }
        return normalize(parsed);
      } catch {
        // Keep the unreadable text so it can be recovered by hand, then start clean.
        try { storage?.setItem(`${key}:corrupt`, raw); } catch { /* nothing more we can do */ }
        return emptyDoc();
      }
    }
    if (storage) {
      const migrated = migrateLegacy(storage, now());
      if (migrated) {
        doc = migrated;
        if (write()) { try { storage.removeItem(LEGACY_PLAN); storage.removeItem(LEGACY_CARDS); } catch { /* ignore */ } }
        return migrated;
      }
    }
    return emptyDoc();
  }

  function write(): boolean {
    if (!storage || !persistent) return false;
    try { storage.setItem(key, JSON.stringify(doc)); return true; }
    catch { persistent = false; return false; } // quota or blocked: carry on in memory
  }

  function schedule() {
    if (debounceMs <= 0) { write(); return; }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; write(); }, debounceMs);
  }

  function notify() { for (const l of [...listeners]) { try { l(doc); } catch { /* a bad listener must not break others */ } } }

  /** Change a copy of the document. The return value of `fn` is ignored. */
  function update(fn: (draft: ProgressDoc) => void) {
    const draft = structuredClone(doc);
    fn(draft);
    draft.version = VERSION;
    doc = normalize(draft);
    schedule();
    notify();
  }

  return {
    get: (): ProgressDoc => doc,
    update,
    subscribe(l: Listener) { listeners.add(l); return () => listeners.delete(l); },
    /** Write any pending change now (call on page hide). */
    flush() { if (timer) { clearTimeout(timer); timer = undefined; write(); } },
    /** Re-read from storage, e.g. after another tab changed it. */
    reload() { doc = load(); notify(); },
    exportJson: (): string => JSON.stringify(doc, null, 2),
    importJson(text: string): ImportResult {
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { return { ok: false, error: 'That is not valid JSON.' }; }
      if (!isObj(parsed) || !isNum(parsed.version)) return { ok: false, error: 'That file does not look like exported progress.' };
      if (parsed.version > VERSION) return { ok: false, error: 'That file was exported by a newer version of the site.' };
      const prev = readRaw();
      if (prev) { try { storage?.setItem(`${key}:backup`, prev); } catch { /* best effort */ } }
      doc = normalize(parsed);
      write();
      notify();
      return { ok: true };
    },
    reset(section?: Section) {
      if (section) update((d) => { (d as unknown as Record<string, unknown>)[section] = emptyDoc()[section]; });
      else { doc = emptyDoc(); write(); notify(); }
    },
    /** False when changes are only being kept in memory. */
    isPersistent: () => persistent,
    /** True when a copy saved before the last import exists. */
    hasBackup: (): boolean => { try { return !!storage?.getItem(`${key}:backup`); } catch { return false; } },
    /** Restore the copy saved before the last import. */
    restoreBackup(): boolean {
      try {
        const b = storage?.getItem(`${key}:backup`);
        if (!b) return false;
        doc = normalize(JSON.parse(b));
        write(); notify();
        return true;
      } catch { return false; }
    },
  };
}

export type ProgressStore = ReturnType<typeof createStore>;

/* ------------------------------------------------------------ browser singleton */

let shared: ProgressStore | undefined;

function safeLocalStorage(): StorageLike | null {
  try {
    const s = window.localStorage;
    const probe = `${STORE_KEY}:probe`;
    s.setItem(probe, '1'); s.removeItem(probe);
    return s;
  } catch { return null; }
}

/** The store for this page. Cross-tab changes are picked up; pending writes flush when the page hides. */
export function getProgress(): ProgressStore {
  if (shared) return shared;
  shared = createStore({ storage: typeof window === 'undefined' ? null : safeLocalStorage(), debounceMs: 150 });
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => { if (e.key === STORE_KEY || e.key === null) shared!.reload(); });
    window.addEventListener('pagehide', () => shared!.flush());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') shared!.flush(); });
  }
  return shared;
}

export { newItem };
