// A three-way status control on each solution: not started, attempted, done.
import { getProgress } from '../../lib/progress';

export function mount(host: HTMLElement) {
  const path = host.dataset.path!;
  const progress = getProgress();
  const options = [['', 'Not started'], ['attempted', 'Attempted'], ['done', 'Done']] as const;

  const render = () => {
    const status = progress.get().solutions[path]?.status ?? '';
    host.innerHTML = `<span class="status-label" id="sol-status-label">Your status</span>
      <div class="seg small" role="group" aria-labelledby="sol-status-label">
        ${options.map(([v, label]) => `<button type="button" data-v="${v}" aria-pressed="${v === status}"><b>${label}</b></button>`).join('')}
      </div>`;
  };
  host.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-v]');
    if (!b) return;
    const v = b.dataset.v as '' | 'attempted' | 'done';
    progress.update((d) => {
      if (!v) delete d.solutions[path];
      else d.solutions[path] = { ...(d.solutions[path] ?? {}), status: v };
    });
    render();
    host.querySelector<HTMLElement>(`[data-v="${v}"]`)?.focus();
  });
  progress.subscribe(() => { if (!host.contains(document.activeElement)) render(); });
  render();
}
