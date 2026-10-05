// "Your data": export, import and reset everything the site remembers. Nothing leaves the browser.

import { getProgress, type Section } from '../../lib/progress';
import { summarize } from '../../lib/srs';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const RESETS: { section: Section; label: string }[] = [
  { section: 'cards', label: 'Flashcards' },
  { section: 'plan', label: 'Study planner' },
  { section: 'quiz', label: 'Quizzes' },
  { section: 'solutions', label: 'Solutions' },
  { section: 'read', label: 'Reading marks' },
];

export function mount(host: HTMLElement) {
  const progress = getProgress();
  let message = '';
  let armed: string | null = null; // reset button waiting for a second click
  let resetOpen = false;           // keep the Reset section open across re-renders

  const root = document.createElement('section');
  root.className = 'widget data-panel';
  root.setAttribute('aria-label', 'Your data');
  host.replaceChildren(root);

  function render() {
    const d = progress.get();
    const cards = Object.values(d.cards);
    const s = summarize(cards, cards.length, Date.now());
    const planDone = Object.values(d.plan.done).reduce((n, a) => n + a.length, 0);
    root.innerHTML = `
      <div class="widget-head"><div><p class="eyebrow">Your data</p><h3>Progress stays in this browser</h3>
        <p>There are no accounts. Export a file to back up your progress or move it to another device.</p></div></div>
      ${progress.isPersistent() ? '' : '<p class="dp-warn" role="alert">This browser is blocking storage, so progress will be lost when the tab closes. Export a file to keep it.</p>'}
      <dl class="fc-stats" aria-label="What is saved">
        <div><dt>Cards studied</dt><dd>${cards.length}</dd></div>
        <div><dt>Cards mastered</dt><dd>${s.mastered}</dd></div>
        <div><dt>Planner items</dt><dd>${planDone}</dd></div>
        <div><dt>Pages read</dt><dd>${Object.keys(d.read).length}</dd></div>
      </dl>
      <div class="dp-actions">
        <button type="button" class="btn primary" data-act="export">Export progress</button>
        <label class="btn dp-file">Import progress<input type="file" accept="application/json,.json" data-act="import" hidden /></label>
        ${progress.hasBackup() ? '<button type="button" class="btn" data-act="restore">Undo last import</button>' : ''}
      </div>
      <p class="dp-msg" role="status" aria-live="polite">${esc(message)}</p>
      <details class="dp-reset"${resetOpen ? ' open' : ''}><summary>Reset</summary>
        <p class="ch-note">Resetting cannot be undone. Export first if unsure.</p>
        <div class="dp-actions">
          ${RESETS.map((r) => `<button type="button" class="chip-btn" data-reset="${r.section}">${armed === r.section ? 'Click again to confirm' : `Reset ${r.label.toLowerCase()}`}</button>`).join('')}
          <button type="button" class="chip-btn danger" data-reset="all">${armed === 'all' ? 'Click again to confirm' : 'Reset everything'}</button>
        </div>
      </details>`;
  }

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    const reset = t.closest<HTMLElement>('[data-reset]')?.dataset.reset;
    if (act === 'export') {
      progress.flush();
      const blob = new Blob([progress.exportJson()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `primer-progress-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      message = 'Exported. Keep the file somewhere safe.';
    } else if (act === 'restore') {
      message = progress.restoreBackup() ? 'Restored what you had before the last import.' : 'Nothing to restore.';
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
    const res = progress.importJson(text);
    message = res.ok ? 'Imported. Your previous progress was kept as a backup you can undo.' : res.error;
    render();
  });

  render();
}
