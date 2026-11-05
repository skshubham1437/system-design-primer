// Keeping progress safe, shared by every page that saves it: the export download, the reminder to export, and the
// one warning shown when changes are not reaching storage. The rules live in lib/progress.ts.

import { getProgress, needsBackupReminder, type ProgressStore, type SaveProblem } from '../../lib/progress';

export const CAN_BE_CLEARED = 'Browsers can clear this data without asking: Safari deletes it after 7 days of use without a visit to this site.';

const PROBLEMS: Record<SaveProblem, string> = {
  'no-storage': 'Your progress is not being saved. This browser is blocking storage, so it will be lost when the tab closes. Export a copy to keep it.',
  'write-failed': 'Your latest progress has not been saved. This browser refused the write, often because its storage is full. The site will try again on your next change. Export a copy to keep it.',
  unreadable: 'Your progress is not being saved. This browser would not let the site read what it saved earlier. Export a copy to keep what you have done here.',
  'newer-version': 'Your progress is not being saved in this tab, because a newer version of the site has saved it. Reload the page to carry on.',
};

export const saveProblemText = (p: SaveProblem): string => PROBLEMS[p];

export const formatDate = (ts: number): string => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function downloadProgress(progress: ProgressStore) {
  progress.markExported();
  const blob = new Blob([progress.exportJson()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `primer-progress-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** The not-saved warning. One bar on the page whatever was being saved, whether a quiz, a note or an exercise. */
export function watchSaves(progress: ProgressStore = getProgress()) {
  let bar: HTMLElement | null = null;
  let dismissed = false;

  const sync = () => {
    const problem = progress.hasUnsavedChanges() ? progress.saveProblem() : null;
    if (!problem) dismissed = false;
    if (!problem || dismissed) { bar?.remove(); bar = null; return; }
    if (bar) return;
    bar = document.createElement('div');
    bar.className = 'save-warn';
    bar.setAttribute('role', 'alert');
    bar.innerHTML = `<p>${saveProblemText(problem)}</p>
      <div class="save-warn-actions">
        <button type="button" class="btn" data-save-warn="export">Export a copy</button>
        <button type="button" class="btn" data-save-warn="dismiss">Dismiss</button>
      </div>`;
    bar.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-save-warn]')?.dataset.saveWarn;
      if (act === 'export') downloadProgress(progress);
      else if (act === 'dismiss') { dismissed = true; sync(); }
    });
    document.body.append(bar);
  };

  progress.onSaveStatus(sync);
  sync();
}

/** A quiet note, shown only when there is meaningful progress that no recent file holds. Fills `host` itself. */
export function mountBackupReminder(host: HTMLElement, progress: ProgressStore) {
  host.classList.add('backup-note');
  host.hidden = true;
  let shown = '';

  const sync = () => {
    const d = progress.get();
    const last = d.backup.exportedAt === undefined ? 'You have not exported it yet.' : `You last exported it on ${formatDate(d.backup.exportedAt)}.`;
    const html = needsBackupReminder(d, Date.now())
      ? `<p><b>Keep a copy of your progress.</b> ${last} It is stored only in this browser. ${CAN_BE_CLEARED}</p>
         <button type="button" class="btn" data-backup-export>Export now</button>`
      : '';
    if (html === shown) return;
    shown = html;
    host.innerHTML = html;
    host.hidden = !html;
  };

  host.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-backup-export]')) downloadProgress(progress); });
  progress.subscribe(sync);
  sync();
}
