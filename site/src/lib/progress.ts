// One versioned, exportable store for everything a learner does on the site.
// Pure of the DOM except for an optional browser adapter at the bottom, so the logic is unit tested.
//
// Guarantees:
//  - corrupt or unreadable data never throws and never silently destroys a good copy
//  - if storage is unavailable (private mode, blocked, full) the app keeps working in memory and says so,
//    and a failed write is tried again on the next change
//  - a change waiting to be written survives another tab saving first: it is replayed on top of their copy
//  - sections this build does not recognise are kept, so an older tab cannot delete a newer section
//  - importing validates first, keeps the previous document as a backup, and reports a write that failed
//
// Browsers can still delete all of it (Safari after 7 days of use without a visit), so the only real
// protection is an exported file: see needsBackupReminder and scripts/features/backup.ts.

import { newItem, type SrsItem } from './srs';

export const STORE_KEY = 'primer:v1';
export const VERSION = 1;

export interface ReadMark { at: number; pct: number }
export interface QuizAttempt { id: string; score: number; of: number; at: number }
export interface SolutionState { status: 'attempted' | 'done'; step?: string; notes?: Record<string, string>; rubric?: Record<string, string[]> }
export interface Session { id: string; question: string; minutes: number; notes: Record<string, string>; at: number }
/** A query-tuning exercise: how many checked attempts, hints seen, when it was first solved, and whether the answer was revealed. */
export interface ExerciseState { attempts: number; hints: number; solved?: number; revealed?: boolean }

export interface ProgressDoc {
  version: number;
  read: Record<string, ReadMark>;
  plan: { last?: string; done: Record<string, number[]> };
  cards: Record<string, SrsItem>;
  quiz: { attempts: QuizAttempt[]; items: Record<string, SrsItem> };
  solutions: Record<string, SolutionState>;
  paths: Record<string, { stage: number }>;
  choosers: Record<string, { guided: number; attempts: { score: number; of: number; at: number }[] }>;
  sessions: Session[];
  exercises: Record<string, ExerciseState>;
  settings: { newCardsPerDay: number };
  /** New flashcards introduced on `day` (local midnight), to enforce the daily limit. */
  daily: { day: number; newCards: number };
  /** When progress was last exported, and when anything worth backing up last changed. */
  backup: { exportedAt?: number; changedAt?: number };
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
  choosers: {},
  sessions: [],
  exercises: {},
  settings: { newCardsPerDay: 10 },
  daily: { day: 0, newCards: 0 },
  backup: {},
});

const KNOWN_SECTIONS = new Set(Object.keys(emptyDoc()));

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
  d.choosers = mapOf(raw.choosers, (x) => (isObj(x)
    ? { guided: isNum(x.guided) ? x.guided : 0, attempts: Array.isArray(x.attempts) ? x.attempts.filter((a): a is { score: number; of: number; at: number } => isObj(a) && isNum(a.score) && isNum(a.of) && isNum(a.at)).slice(-50) : [] }
    : undefined));
  d.exercises = mapOf(raw.exercises, (x) => (isObj(x) && isNum(x.attempts)
    ? { attempts: Math.max(0, Math.round(x.attempts)), hints: isNum(x.hints) ? Math.max(0, Math.round(x.hints)) : 0, ...(isNum(x.solved) ? { solved: x.solved } : {}), ...(x.revealed === true ? { revealed: true } : {}) }
    : undefined));
  if (Array.isArray(raw.sessions)) d.sessions = raw.sessions.filter((s): s is Session => isObj(s) && typeof s.id === 'string');
  if (isObj(raw.settings) && isNum(raw.settings.newCardsPerDay)) d.settings.newCardsPerDay = Math.min(100, Math.max(0, Math.round(raw.settings.newCardsPerDay)));
  if (isObj(raw.daily) && isNum(raw.daily.day) && isNum(raw.daily.newCards)) d.daily = { day: raw.daily.day, newCards: Math.max(0, Math.round(raw.daily.newCards)) };
  if (isObj(raw.backup)) {
    if (isNum(raw.backup.exportedAt)) d.backup.exportedAt = raw.backup.exportedAt;
    if (isNum(raw.backup.changedAt)) d.backup.changedAt = raw.backup.changedAt;
  }
  // A section added by a newer build passes through untouched, so a tab running older code cannot delete it.
  for (const [k, v] of Object.entries(raw)) {
    if (!KNOWN_SECTIONS.has(k) && k !== '__proto__') (d as unknown as Record<string, unknown>)[k] = v;
  }
  return d;
}

/* ------------------------------------------------------------ what would be lost */

export interface ProgressCounts { cards: number; pages: number; quizzes: number; planner: number; solutions: number; exercises: number; choosers: number; paths: number; sessions: number }

export function countProgress(d: ProgressDoc): ProgressCounts {
  return {
    cards: Object.values(d.cards).filter((c) => c.seen > 0).length,
    pages: Object.keys(d.read).length,
    quizzes: d.quiz.attempts.length,
    planner: Object.values(d.plan.done).reduce((n, a) => n + a.length, 0),
    solutions: Object.keys(d.solutions).length,
    exercises: Object.keys(d.exercises).length,
    choosers: Object.keys(d.choosers).length,
    paths: Object.keys(d.paths).length,
    sessions: d.sessions.length,
  };
}

export const totalProgress = (c: ProgressCounts): number => Object.values(c).reduce((n, x) => n + x, 0);

/** Below this many saved items there is not enough to lose to be worth interrupting anyone: about one session. */
export const REMIND_MIN_ITEMS = 10;
/** Safari's limit, and a sensible gap between reminders for anyone else. */
export const REMIND_AFTER_DAYS = 7;

/** There is a meaningful amount of progress, and no recent file holds the latest of it. */
export function needsBackupReminder(d: ProgressDoc, now: number): boolean {
  if (totalProgress(countProgress(d)) < REMIND_MIN_ITEMS) return false;
  const { exportedAt, changedAt } = d.backup;
  if (exportedAt === undefined) return true;
  return (changedAt ?? 0) > exportedAt && now - exportedAt >= REMIND_AFTER_DAYS * 86_400_000;
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
export type ImportResult = { ok: true; noBackup?: true } | { ok: false; error: string };
export type ImportPreview = { ok: true; current: ProgressCounts; incoming: ProgressCounts } | { ok: false; error: string };
/** Why changes are not reaching storage. Only `write-failed` is expected to clear by itself on the next change. */
export type SaveProblem = 'no-storage' | 'newer-version' | 'unreadable' | 'write-failed';

export interface StoreOptions {
  storage: StorageLike | null;
  key?: string;
  /** Wait this long after the last change before writing; 0 writes immediately. */
  debounceMs?: number;
  now?: () => number;
}

type Change = (draft: ProgressDoc) => void;

function parseExport(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { ok: false, error: 'That is not valid JSON.' }; }
  if (!isObj(parsed) || !isNum(parsed.version)) return { ok: false, error: 'That file does not look like exported progress.' };
  if (parsed.version > VERSION) return { ok: false, error: 'That file was exported by a newer version of the site.' };
  return { ok: true, value: parsed };
}

/** Everything a learner would mind losing. Not settings, and not the backup dates themselves. */
const learningText = (d: ProgressDoc) => JSON.stringify({ ...d, version: 0, settings: 0, backup: 0 });

function apply(base: ProgressDoc, change: Change): ProgressDoc {
  const draft = structuredClone(base);
  change(draft);
  draft.version = VERSION;
  return normalize(draft);
}

export function createStore({ storage, key = STORE_KEY, debounceMs = 0, now = Date.now }: StoreOptions) {
  const backupKey = `${key}:backup`;
  const listeners = new Set<Listener>();
  const saveListeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** This tab must not write: the stored document is from a newer build, or could not be read or set aside. */
  let blocked: 'newer-version' | 'unreadable' | null = null;
  let writeFailed = false;
  /** Changes not yet in storage, oldest first. Kept as functions so they can be replayed on someone else's copy. */
  let pending: Change[] = [];
  /** The stored text as this tab last saw it. Anything else there means another tab has written since. */
  let seen: string | null = null;
  /** Something changed in memory that has not reached storage. */
  let unsaved = false;
  let reported = false;
  let doc: ProgressDoc = emptyDoc();
  pull();

  /** The stored text, null if there is none, undefined if storage would not say. */
  function readRaw(): string | null | undefined {
    try { return storage ? storage.getItem(key) : null; } catch { return undefined; }
  }

  function parseStored(raw: string): ProgressDoc {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
    if (!isObj(parsed)) {
      // Unreadable, or valid JSON that is no document. Keep the text so it can be recovered by hand, then start
      // clean. If it cannot be kept, do not write over the only copy.
      try { storage?.setItem(`${key}:corrupt`, raw); } catch { blocked = 'unreadable'; }
      return emptyDoc();
    }
    if (isNum(parsed.version) && parsed.version > VERSION) blocked = 'newer-version'; // do not touch it; work in memory
    return normalize(parsed);
  }

  /** Take what is stored as the new base and replay our unwritten changes on top. */
  function pull() {
    const raw = readRaw();
    // Keep what we hold. A write now could destroy a document we cannot see.
    if (raw === undefined) { blocked = 'unreadable'; return; }
    blocked = null;
    seen = raw;
    const migrated = raw === null && storage ? migrateLegacy(storage, now()) : null;
    const base = raw === null ? migrated ?? emptyDoc() : parseStored(raw);
    doc = pending.reduce((d, c) => { try { return apply(d, c); } catch { return d; } }, base);
    if (migrated) {
      unsaved = true;
      if (push()) { try { storage!.removeItem(LEGACY_PLAN); storage!.removeItem(LEGACY_CARDS); } catch { /* ignore */ } }
    }
  }

  /** Write `doc` as it stands. On failure everything stays pending, so the next attempt carries it. */
  function push(): boolean {
    if (!storage || blocked) { report(); return false; }
    const text = JSON.stringify(doc);
    try { storage.setItem(key, text); }
    catch { writeFailed = true; report(); return false; } // quota or blocked: carry on in memory
    seen = text;
    pending = [];
    writeFailed = false;
    unsaved = false;
    report();
    return true;
  }

  /** Save pending changes without overwriting anything another tab wrote since we last looked. */
  function save(): boolean {
    if (storage && (readRaw() !== seen || blocked)) { pull(); notify(); }
    return push();
  }

  function schedule() {
    if (debounceMs <= 0) { save(); return; }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; save(); }, debounceMs);
  }

  function saveProblem(): SaveProblem | null {
    if (!storage) return 'no-storage';
    return blocked ?? (writeFailed ? 'write-failed' : null);
  }

  function hasUnsavedChanges(): boolean { return unsaved && saveProblem() !== null; }

  function report() {
    const state = hasUnsavedChanges();
    if (state === reported) return;
    reported = state;
    for (const l of [...saveListeners]) { try { l(); } catch { /* a bad listener must not break others */ } }
  }

  function notify() { for (const l of [...listeners]) { try { l(doc); } catch { /* a bad listener must not break others */ } } }

  function change(c: Change) {
    doc = apply(doc, c);
    if (storage) pending.push(c);
    unsaved = true;
    schedule();
    report();
    notify();
  }

  /**
   * Change a copy of the document. The return value of `fn` is ignored.
   * `fn` runs again if another tab saves before this change is written, possibly much later if writes are failing,
   * so it must have no side effects and must capture values that could change (see the study planner).
   */
  function update(fn: (draft: ProgressDoc) => void) {
    change((d) => {
      const before = learningText(d);
      fn(d);
      if (learningText(d) !== before) d.backup.changedAt = now();
    });
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (pending.length) save();
  }

  /** Swap the whole document, keeping the current one if the new one cannot be written. */
  function replace(next: ProgressDoc): boolean {
    const before = { doc, pending, unsaved };
    doc = next;
    pending = [];
    if (push()) { notify(); return true; }
    ({ doc, pending, unsaved } = before);
    report();
    return false;
  }

  return {
    get: (): ProgressDoc => doc,
    update,
    subscribe(l: Listener) { listeners.add(l); return () => listeners.delete(l); },
    /** Hear when changes stop reaching storage, and when they start again. */
    onSaveStatus(l: () => void) { saveListeners.add(l); return () => saveListeners.delete(l); },
    /** Write any pending change now, retrying one that failed (call on page hide). */
    flush,
    /** Re-read from storage, e.g. after another tab changed it. Changes waiting to be written are kept. */
    reload() { pull(); report(); notify(); },
    exportJson: (): string => JSON.stringify(doc, null, 2),
    /** Record that the learner is taking a copy now. Call before exportJson so the file carries the date. */
    markExported() { const at = now(); change((d) => { d.backup.exportedAt = at; }); flush(); },
    /** What an import of this text would replace. Changes nothing. */
    previewImport(text: string): ImportPreview {
      const parsed = parseExport(text);
      if (!parsed.ok) return parsed;
      return { ok: true, current: countProgress(doc), incoming: countProgress(normalize(parsed.value)) };
    },
    importJson(text: string): ImportResult {
      const parsed = parseExport(text);
      if (!parsed.ok) return parsed;
      const notSaved: ImportResult = { ok: false, error: 'This browser would not save the import, so your progress has not changed.' };
      flush();
      if (readRaw() !== seen) { pull(); notify(); }
      if (!storage || blocked) return notSaved;
      // The copy kept for undo is what this tab holds, which includes anything a failed write left behind.
      const hadData = seen !== null || pending.length > 0;
      let oldBackup: string | null = null;
      try { oldBackup = storage.getItem(backupKey); } catch { /* treated as none */ }
      let noBackup = false;
      if (hadData) {
        try { storage.setItem(backupKey, JSON.stringify(doc)); }
        catch { noBackup = true; try { storage.removeItem(backupKey); } catch { /* best effort */ } } // an older copy must not pass as this one
      }
      if (!replace(normalize(parsed.value))) {
        if (hadData) {
          try { if (oldBackup === null) storage.removeItem(backupKey); else storage.setItem(backupKey, oldBackup); } catch { /* best effort */ }
        }
        return notSaved;
      }
      return noBackup ? { ok: true, noBackup: true } : { ok: true };
    },
    reset(section?: Section) {
      if (section) { update((d) => { (d as unknown as Record<string, unknown>)[section] = emptyDoc()[section]; }); return; }
      change((d) => {
        const all = d as unknown as Record<string, unknown>;
        for (const k of Object.keys(all)) delete all[k];
        Object.assign(all, emptyDoc());
      });
      flush();
    },
    /** False when changes are only being kept in memory. */
    isPersistent: () => saveProblem() === null,
    saveProblem,
    /** True when something has changed that is not in storage and is not simply waiting for the save delay. */
    hasUnsavedChanges,
    /** True when a copy saved before the last import exists. */
    hasBackup: (): boolean => { try { return !!storage?.getItem(backupKey); } catch { return false; } },
    /** Restore the copy saved before the last import. False if there is none or it could not be written. */
    restoreBackup(): boolean {
      try {
        const b = storage?.getItem(backupKey);
        return b ? replace(normalize(JSON.parse(b))) : false;
      } catch { return false; }
    },
  };
}

export type ProgressStore = ReturnType<typeof createStore>;

/* ------------------------------------------------------------ browser singleton */

let shared: ProgressStore | undefined;

/** Reading is what decides this. A full localStorage rejects writes but still holds the learner's progress. */
function safeLocalStorage(): StorageLike | null {
  try {
    const s = window.localStorage;
    s.getItem(STORE_KEY);
    return s;
  } catch { return null; }
}

/**
 * Ask the browser not to evict this site's data. Best effort: WebKit decides on its own heuristics, and Firefox may
 * show a prompt, so ask once per browser rather than once per page.
 */
export function requestDurableStorage(storage: StorageLike | null, manager: { persist?: () => Promise<boolean> } | undefined) {
  if (!storage || !manager?.persist) return;
  const asked = `${STORE_KEY}:persist-asked`;
  try {
    if (storage.getItem(asked)) return;
    storage.setItem(asked, '1');
  } catch { return; }
  try { manager.persist().catch(() => {}); } catch { /* best effort */ }
}

/** The store for this page. Cross-tab changes are picked up; pending writes flush when the page hides. */
export function getProgress(): ProgressStore {
  if (shared) return shared;
  const storage = typeof window === 'undefined' ? null : safeLocalStorage();
  shared = createStore({ storage, debounceMs: 150 });
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => { if (e.key === STORE_KEY || e.key === null) shared!.reload(); });
    window.addEventListener('pagehide', () => shared!.flush());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') shared!.flush(); });
    const stop = shared.subscribe(() => { stop(); requestDurableStorage(storage, navigator.storage); });
  }
  return shared;
}

export { newItem };
