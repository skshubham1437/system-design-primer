// A query-tuning exercise: change the schema or the query, then let the real engine judge the plan it chooses.
// Every attempt runs inside a transaction that is rolled back (see src/lib/db/exercise.ts), so nothing sticks.
import { startEngine, engineStarted } from '../db/engine';
import { esc, errorHtml, planTextHtml } from '../db/render';
import { runAttempt, type Exercise, type Executor, type AttemptResult } from '../../lib/db/exercise';
import { getProgress } from '../../lib/progress';

const dots = (n: number) => `<span class="sqlx-diff" aria-label="Difficulty ${n} of 3">${'●'.repeat(n)}${'○'.repeat(3 - n)}</span>`;

export async function mount(host: HTMLElement) {
  const id = host.dataset.id!;
  const src = host.dataset.src ?? `${document.documentElement.dataset.base ?? '/'}data/db/exercises/${id}.json`;
  let ex: Exercise;
  try { ex = await (await fetch(src)).json(); } catch { return; } // the static version stays in place
  const progress = getProgress();
  const state = () => progress.get().exercises[id] ?? { attempts: 0, hints: 0 };
  const touch = (f: (s: { attempts: number; hints: number; solved?: number; revealed?: boolean }) => void) =>
    progress.update((d) => { const s = (d.exercises[id] ??= { attempts: 0, hints: 0 }); f(s); });

  const root = document.createElement('section');
  root.className = 'widget sqlx';
  root.setAttribute('aria-label', `Exercise: ${ex.title}`);
  root.innerHTML = `
    <div class="widget-head"><div>
      <p class="eyebrow">Exercise ${dots(ex.difficulty)} ${ex.reviewed ? '' : '<span class="sqlx-draft">Draft</span>'} <span class="sqlx-solved" hidden>Solved</span></p>
      <h3>${esc(ex.title)}</h3>
      <p>${esc(ex.scenario)}</p>
      <p class="sqlx-task"><b>Your task.</b> ${esc(ex.task)}</p>
    </div></div>
    <div class="sqlx-body">
      ${ex.allowChanges ? `<label class="sqlp-label" for="x-${id}-changes">Changes to make first <small>for example CREATE INDEX; undone after each check</small></label>
      <textarea id="x-${id}-changes" class="sqlp-sql sqlx-changes" rows="2" spellcheck="false" autocomplete="off" placeholder="-- nothing yet"></textarea>` : ''}
      <label class="sqlp-label" for="x-${id}-query">Query <small>${ex.allowChanges ? 'you may edit it, as long as it returns the same rows' : 'rewrite it so it returns the same rows, faster'}</small></label>
      <textarea id="x-${id}-query" class="sqlp-sql" rows="${Math.min(8, ex.query.trim().split('\n').length + 1)}" spellcheck="false" autocomplete="off"></textarea>
      <div class="sqlp-actions">
        <button type="button" class="btn primary" data-x="check">Check my answer</button>
        <button type="button" class="btn" data-x="original">Explain the original</button>
        <button type="button" class="chip-btn" data-x="hint"></button>
        <button type="button" class="chip-btn" data-x="answer">Show the answer</button>
        <button type="button" class="chip-btn" data-x="reset">Start again</button>
      </div>
      <ol class="sqlx-hints" aria-label="Hints"></ol>
    </div>
    <p class="sqlp-status" role="status" aria-live="polite"></p>
    <div class="sqlx-out"></div>`;
  host.replaceChildren(root);

  const q = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const changesBox = ex.allowChanges ? q<HTMLTextAreaElement>('.sqlx-changes') : null;
  const queryBox = q<HTMLTextAreaElement>(`#x-${id}-query`);
  queryBox.value = ex.query.trim();
  const status = (m: string) => { q('.sqlp-status').textContent = m; };
  const out = (h: string) => { q('.sqlx-out').innerHTML = h; };

  const drawHints = () => {
    const shown = Math.min(state().hints, ex.hints.length);
    q('.sqlx-hints').innerHTML = ex.hints.slice(0, shown).map((h) => `<li>${esc(h)}</li>`).join('');
    const btn = q<HTMLButtonElement>('[data-x="hint"]');
    btn.textContent = shown >= ex.hints.length ? 'No more hints' : shown === 0 ? `Show a hint (${ex.hints.length})` : `Next hint (${ex.hints.length - shown} left)`;
    btn.disabled = shown >= ex.hints.length;
    q('.sqlx-solved').hidden = !state().solved;
  };

  const resultHtml = (r: AttemptResult, original: boolean) => `
    <div class="sqlx-verdict ${r.passed ? 'ok' : ''}">${r.passed
      ? '<b>Solved.</b> Every check passes.'
      : original ? '<b>This is the starting point.</b> Each check below says what is wrong with it.' : '<b>Not yet.</b> The failing checks say why.'}</div>
    <ul class="sqlx-checks">${r.checks.map((c) => `<li class="${c.ok ? 'ok' : 'no'}"><span class="sqlx-mark" aria-hidden="true">${c.ok ? '✓' : '✗'}</span><span><b>${esc(c.label)}</b> <span class="sr-only">${c.ok ? 'passed' : 'failed'}.</span> ${esc(c.detail)}</span></li>`).join('')}</ul>
    ${r.passed && !original ? `<div class="sqlx-why"><h4>Why it was slow</h4><p>${esc(ex.why)}</p></div>` : ''}
    <details class="sqlx-plan" ${r.passed ? '' : 'open'}><summary>The plan the database chose</summary>${planTextHtml(r.planText, 'Query plan')}</details>`;

  const busy = (on: boolean) => { root.toggleAttribute('aria-busy', on); root.querySelectorAll<HTMLButtonElement>('[data-x="check"], [data-x="original"]').forEach((b) => (b.disabled = on)); };

  const attempt = async (original: boolean) => {
    busy(true);
    status(engineStarted() ? 'Running inside a transaction that will be rolled back…' : 'Starting the database (about 5.6 MB the first time), then running…');
    try {
      const engine = await startEngine();
      const db: Executor = { exec: (s) => engine.exec(s), query: async (s) => (await engine.query(s)) as never };
      const r = await runAttempt(db, ex, original ? { query: ex.query } : { changes: changesBox?.value, query: queryBox.value });
      out(resultHtml(r, original));
      if (!original) {
        touch((s) => { s.attempts++; if (r.passed && !s.solved) s.solved = Date.now(); });
        status(r.passed ? `Solved in ${state().attempts} attempt${state().attempts === 1 ? '' : 's'}.` : `${r.checks.filter((c) => !c.ok).length} check${r.checks.filter((c) => !c.ok).length === 1 ? '' : 's'} still failing.`);
      } else status('The original query, explained. Nothing was changed.');
    } catch (e) {
      out(errorHtml(e));
      status('That did not run. Nothing was changed.');
    } finally {
      busy(false);
      drawHints();
    }
  };

  root.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-x]')?.dataset.x;
    if (act === 'check') void attempt(false);
    else if (act === 'original') void attempt(true);
    else if (act === 'hint') { touch((s) => { s.hints = Math.min(ex.hints.length, s.hints + 1); }); drawHints(); }
    else if (act === 'answer') {
      touch((s) => { s.revealed = true; });
      if (changesBox) changesBox.value = ex.solution.changes?.trim() ?? '';
      queryBox.value = (ex.solution.query ?? ex.query).trim();
      out(`<div class="sqlx-why"><h4>The answer</h4><p>It is now in the boxes above. Press <b>Check my answer</b> to see its plan.</p><p>${esc(ex.why)}</p></div>`);
      status('The answer is filled in.');
    } else if (act === 'reset') {
      if (changesBox) changesBox.value = '';
      queryBox.value = ex.query.trim();
      out('');
      status('Back to the original query.');
    }
  });
  [changesBox, queryBox].forEach((b) => b?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void attempt(false); } }));
  drawHints();
}
