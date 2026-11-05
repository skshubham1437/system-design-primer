// "Try it first": work through a solution one step at a time. You write your own answer before the
// reference is revealed, then check yourself against a short rubric. Everything is saved locally.

import { getProgress } from '../../lib/progress';

interface Step { id: string; prompt: string; rubric: string[] }
interface Data { reviewed: boolean; steps: Step[] }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function mount(host: HTMLElement) {
  const path = host.dataset.path!;
  const src = host.dataset.src!;
  const article = host.closest<HTMLElement>('article.article');
  const prose = article?.querySelector<HTMLElement>('.prose');
  if (!article || !prose) return;
  const progress = getProgress();
  const modeKey = `primer:practice-mode:${path}`;

  let data: Data;
  let index = 0;                       // which step is showing; steps.length means the summary
  let revealed: Record<string, boolean> = {};
  let on = false;

  const toggle = document.createElement('div');
  toggle.className = 'practice-toggle';
  host.replaceChildren(toggle);
  const panel = document.createElement('section');
  panel.className = 'practice-panel';
  panel.setAttribute('aria-label', 'Practice mode');
  panel.hidden = true;
  prose.before(panel);

  const mine = () => progress.get().solutions[path];
  const notesOf = (id: string) => mine()?.notes?.[id] ?? '';
  const checked = (id: string) => new Set(mine()?.rubric?.[id] ?? []);

  function remember(fn: (s: NonNullable<ReturnType<typeof mine>>) => void) {
    progress.update((d) => {
      const s = d.solutions[path] ?? { status: 'attempted' as const };
      fn(s);
      d.solutions[path] = s;
    });
  }

  function titleOf(id: string): string {
    return prose!.querySelector(`[data-step="${id}"] > h2`)?.childNodes[0]?.textContent?.trim() ?? id;
  }
  function showSections() {
    prose!.querySelectorAll<HTMLElement>('[data-step]').forEach((s) => s.classList.toggle('is-open', !!revealed[s.dataset.step!] || !on));
  }

  function renderToggle() {
    toggle.innerHTML = `<span class="status-label" id="mode-label">How would you like to work?</span>
      <div class="seg small" role="group" aria-labelledby="mode-label">
        <button type="button" data-mode="read" aria-pressed="${!on}"><b>Read the solution</b></button>
        <button type="button" data-mode="practice" aria-pressed="${on}"><b>Try it first</b><small>write your answer, then reveal</small></button>
      </div>`;
  }

  function renderPanel() {
    article!.classList.toggle('practice-on', on);
    panel.hidden = !on;
    showSections();
    if (!on) return;
    const steps = data.steps;
    const draft = data.reviewed ? '' : '<p class="quiz-draft"><b>Draft.</b> This rubric has not been checked by a second person yet.</p>';

    if (index >= steps.length) {
      const rows = steps.map((s) => {
        const got = checked(s.id).size;
        const missed = s.rubric.filter((_, i) => !checked(s.id).has(String(i)));
        return `<li><b>${esc(titleOf(s.id))}</b> <span class="pp-score">${got} of ${s.rubric.length}</span>
          ${missed.length ? `<ul class="pp-missed">${missed.map((m) => `<li>${esc(m.replace(/^I /, 'To cover: '))}</li>`).join('')}</ul>` : '<span class="pp-good">Everything covered.</span>'}</li>`;
      }).join('');
      const status = mine()?.status;
      panel.innerHTML = `${draft}
        <p class="quiz-count">Finished</p>
        <h3 class="pp-title" tabindex="-1">What to work on</h3>
        <ol class="pp-summary">${rows}</ol>
        <p>Now try the <a href="#followups">follow-up questions</a> at the end of the page, the kind an interviewer asks next.</p>
        <div class="quiz-actions">
          <button type="button" class="btn primary" data-act="done" ${status === 'done' ? 'disabled' : ''}>${status === 'done' ? 'Marked as done' : 'Mark this solution as done'}</button>
          <button type="button" class="btn" data-act="restart">Go through it again</button>
          <button type="button" class="btn" data-act="read">Read the whole solution</button>
        </div>`;
      panel.querySelector<HTMLElement>('.pp-title')?.focus({ preventScroll: true });
      return;
    }

    const s = steps[index];
    const open = !!revealed[s.id];
    const ticks = checked(s.id);
    panel.innerHTML = `${draft}
      <div class="quiz-bar" role="progressbar" aria-label="Practice progress" aria-valuemin="0" aria-valuemax="${steps.length}" aria-valuenow="${index}"><i style="width:${(index / steps.length) * 100}%"></i></div>
      <p class="quiz-count">Step ${index + 1} of ${steps.length}</p>
      <h3 class="pp-title" tabindex="-1">${esc(titleOf(s.id))}</h3>
      <p class="pp-prompt">${esc(s.prompt)}</p>
      <label class="pp-label" for="pp-notes">Your answer (saved in this browser)</label>
      <textarea id="pp-notes" rows="7" placeholder="Write it out as you would say it in an interview…">${esc(notesOf(s.id))}</textarea>
      ${open ? `
        <fieldset class="pp-rubric"><legend>Now check yourself against the reference above. Tick what you covered.</legend>
          ${s.rubric.map((r, i) => `<label><input type="checkbox" data-r="${i}" ${ticks.has(String(i)) ? 'checked' : ''} /> <span>${esc(r)}</span></label>`).join('')}
        </fieldset>`
        : '<p class="ch-note">Write something first, even a rough outline. Then reveal the reference and compare.</p>'}
      <div class="quiz-actions">
        ${index > 0 ? '<button type="button" class="btn" data-act="back">Back</button>' : ''}
        ${open ? '' : '<button type="button" class="btn primary" data-act="reveal">Reveal the reference</button>'}
        <button type="button" class="btn ${open ? 'primary' : ''}" data-act="next">${index === steps.length - 1 ? 'Finish' : 'Next step'}</button>
      </div>`;
    panel.querySelector<HTMLElement>('.pp-title')?.focus({ preventScroll: true });
  }

  function go(i: number) { index = i; remember((s) => { s.step = data.steps[i]?.id; }); renderPanel(); panel.scrollIntoView({ block: 'start', behavior: 'auto' }); }

  panel.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    const step = data.steps[index];
    if (act === 'reveal') {
      revealed[step.id] = true;
      remember(() => {});
      renderPanel();
      prose.querySelector<HTMLElement>(`[data-step="${step.id}"]`)?.scrollIntoView({ block: 'start' });
    } else if (act === 'next') go(Math.min(data.steps.length, index + 1));
    else if (act === 'back') go(Math.max(0, index - 1));
    else if (act === 'done') { remember((s) => { s.status = 'done'; }); renderPanel(); }
    else if (act === 'restart') { revealed = {}; go(0); }
    else if (act === 'read') { setMode(false); }
  });
  panel.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement | HTMLTextAreaElement;
    const step = data.steps[index];
    if (t.id === 'pp-notes') remember((s) => { s.notes = { ...(s.notes ?? {}), [step.id]: t.value }; });
    else if (t.dataset.r !== undefined) {
      const set = checked(step.id);
      (t as HTMLInputElement).checked ? set.add(t.dataset.r) : set.delete(t.dataset.r);
      remember((s) => { s.rubric = { ...(s.rubric ?? {}), [step.id]: [...set] }; });
    }
  });

  function setMode(practice: boolean) {
    on = practice;
    try { sessionStorage.setItem(modeKey, practice ? 'practice' : 'read'); } catch { /* ignore */ }
    renderToggle();
    renderPanel();
  }
  toggle.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-mode]');
    if (!b) return;
    setMode(b.dataset.mode === 'practice');
    if (b.dataset.mode === 'practice') panel.scrollIntoView({ block: 'start' });
  });

  fetch(src).then((r) => r.json() as Promise<Data>).then((d) => {
    data = d;
    const saved = mine()?.step;
    const at = d.steps.findIndex((s) => s.id === saved);
    index = at >= 0 ? at : 0;
    // steps you have notes or ticks for have already been seen, so keep their reference open
    for (const s of d.steps) if (notesOf(s.id) || checked(s.id).size) revealed[s.id] = checked(s.id).size > 0;
    let startOn = false;
    try { startOn = sessionStorage.getItem(modeKey) === 'practice'; } catch { /* ignore */ }
    renderToggle();
    on = startOn;
    renderPanel();
  }).catch(() => { toggle.innerHTML = '<p class="ch-note">Practice mode could not be loaded. You can still read the solution below.</p>'; });
}
