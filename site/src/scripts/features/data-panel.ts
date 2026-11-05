// "Your data": export, import and reset everything the site remembers. Nothing leaves the browser.

import { countProgress, getProgress, totalProgress, type ProgressCounts, type Section } from '../../lib/progress';
import { summarize } from '../../lib/srs';
import { CAN_BE_CLEARED, downloadProgress, formatDate, saveProblemText } from './backup';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const RESETS: { section: Section; label: string }[] = [
  { section: 'cards', label: 'Flashcards' },
  { section: 'plan', label: 'Study planner' },
  { section: 'quiz', label: 'Quizzes' },
  { section: 'solutions', label: 'Solutions' },
  { section: 'read', label: 'Reading marks' },
  { section: 'exercises', label: 'Exercises' },
  { section: 'choosers', label: 'Decision aids' },
  { section: 'paths', label: 'Scaling story' },
];

const COUNT_LABELS: { key: keyof ProgressCounts; label: string }[] = [
  { key: 'cards', label: 'Cards studied' },
  { key: 'pages', label: 'Pages read' },
  { key: 'quizzes', label: 'Quiz attempts' },
  { key: 'planner', label: 'Planner items' },
  { key: 'solutions', label: 'Solutions' },
  { key: 'exercises', label: 'Exercises' },
  { key: 'choosers', label: 'Decision aids' },
  { key: 'paths', label: 'Scaling story' },
  { key: 'sessions', label: 'Practice sessions' },
];

export function mount(host: HTMLElement) {
  const progress = getProgress();
  let message = '';
  let armed: string | null = null; // reset button waiting for a second click
  let resetOpen = false;           // keep the Reset section open across re-renders
  let confirming: { text: string; incoming: ProgressCounts } | null = null; // an import waiting for a yes
  let rendered = '';

  const root = document.createElement('section');
  root.className = 'widget data-panel';
  root.setAttribute('aria-label', 'Your data');
  host.replaceChildren(root);

  function confirmHtml(incoming: ProgressCounts): string {
    const current = countProgress(progress.get());
    const rows = COUNT_LABELS.filter(({ key }) => current[key] || incoming[key])
      .map(({ key, label }) => `<tr><th scope="row">${label}</th><td>${current[key]}</td><td>${incoming[key]}</td></tr>`).join('');
    return `<div class="dp-confirm" role="group" aria-label="Confirm import">
        <p><b>Replace your progress with this file?</b> Everything here now is replaced, not merged. You can undo this once afterwards.</p>
        <table class="dp-compare"><thead><tr><td></td><th scope="col">Now</th><th scope="col">In the file</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="dp-confirm-actions">
          <button type="button" class="btn primary" data-act="import-confirm">Replace my progress</button>
          <button type="button" class="btn" data-act="import-cancel">Keep what I have</button>
        </div>
      </div>`;
  }

  function render() {
    const d = progress.get();
    const cards = Object.values(d.cards);
    const s = summarize(cards, cards.length, Date.now());
    const counts = countProgress(d);
    // Once a change has actually gone unsaved the page-wide warning says this, so do not say it twice.
    const problem = progress.hasUnsavedChanges() ? null : progress.saveProblem();
    const html = `
      <div class="widget-head"><div><p class="eyebrow">Your data</p><h3>Progress stays in this browser</h3>
        <p>There are no accounts, and nothing is sent anywhere. ${CAN_BE_CLEARED} Export a file to keep a copy or move your progress to another device.</p></div></div>
      ${problem ? `<p class="dp-warn" role="alert">${saveProblemText(problem)}</p>` : ''}
      <dl class="fc-stats" aria-label="What is saved">
        <div><dt>Cards studied</dt><dd>${cards.length}</dd></div>
        <div><dt>Cards mastered</dt><dd>${s.mastered}</dd></div>
        <div><dt>Planner items</dt><dd>${counts.planner}</dd></div>
        <div><dt>Pages read</dt><dd>${counts.pages}</dd></div>
      </dl>
      <div class="dp-actions">
        <button type="button" class="btn primary" data-act="export">Export progress</button>
        <label class="btn dp-file">Import progress<input type="file" accept="application/json,.json" data-act="import" hidden /></label>
        ${progress.hasBackup() ? '<button type="button" class="btn" data-act="restore">Undo last import</button>' : ''}
      </div>
      <p class="dp-last">${d.backup.exportedAt === undefined ? 'Not exported yet.' : `Last exported on ${formatDate(d.backup.exportedAt)}.`}</p>
      ${confirming ? confirmHtml(confirming.incoming) : ''}
      <p class="dp-msg" role="status" aria-live="polite">${esc(message)}</p>
      <details class="dp-reset"${resetOpen ? ' open' : ''}><summary>Reset</summary>
        <p class="ch-note">Resetting cannot be undone. Export first if unsure.</p>
        <div class="dp-actions">
          ${RESETS.map((r) => `<button type="button" class="chip-btn" data-reset="${r.section}">${armed === r.section ? 'Click again to confirm' : `Reset ${r.label.toLowerCase()}`}</button>`).join('')}
          <button type="button" class="chip-btn danger" data-reset="all">${armed === 'all' ? 'Click again to confirm' : 'Reset everything'}</button>
        </div>
      </details>`;
    // Re-rendering would discard a file input whose picker is open, so leave the page alone unless something changed.
    if (html === rendered) return;
    rendered = html;
    root.innerHTML = html;
  }

  function runImport(text: string) {
    const res = progress.importJson(text);
    if (!res.ok) message = res.error;
    else message = res.noBackup ? 'Imported, but your previous progress could not be kept as a backup, so this cannot be undone.' : 'Imported. Your previous progress was kept as a backup you can undo.';
  }

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    const reset = t.closest<HTMLElement>('[data-reset]')?.dataset.reset;
    if (act === 'export') {
      downloadProgress(progress);
      message = 'Exported. Keep the file somewhere safe.';
    } else if (act === 'import-confirm' && confirming) {
      runImport(confirming.text);
      confirming = null;
    } else if (act === 'import-cancel') {
      confirming = null;
      message = 'Nothing was imported.';
    } else if (act === 'restore') {
      if (progress.restoreBackup()) message = 'Restored what you had before the last import.';
      else message = progress.hasBackup() ? 'This browser would not save the restored copy, so your progress has not changed.' : 'Nothing to restore.';
    } else if (reset) {
      if (armed !== reset) { armed = reset; render(); return; }
      armed = null;
      if (reset === 'all') progress.reset(); else progress.reset(reset as Section);
      message = 'Reset.';
    } else return;
    armed = reset ? armed : null;
    render();
  });

  // `toggle` does not bubble, so listen in the capture phase
  root.addEventListener('toggle', (e) => { if ((e.target as HTMLElement).matches('.dp-reset')) resetOpen = (e.target as HTMLDetailsElement).open; }, true);

  root.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    if (input.dataset.act !== 'import' || !input.files?.[0]) return;
    const text = await input.files[0].text();
    input.value = ''; // choosing the same file again must still fire `change`
    const preview = progress.previewImport(text);
    confirming = null;
    if (!preview.ok) message = preview.error;
    else if (totalProgress(preview.current) === 0) runImport(text); // nothing here to lose
    else { confirming = { text, incoming: preview.incoming }; message = ''; }
    render();
    root.querySelector<HTMLElement>('[data-act="import-cancel"]')?.focus();
  });

  // Reset and import change what this panel shows, and so can another tab.
  progress.subscribe(render);
  progress.onSaveStatus(render);
  render();
}
