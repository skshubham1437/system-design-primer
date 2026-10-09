// Decision aids. "Guide me" walks a question tree to a recommendation with its trade-offs; "Test me" gives
// realistic scenarios where you commit to an answer first and then see why each option does or does not fit.

import { getProgress } from '../../lib/progress';

interface Option { label: string; next?: string; result?: string }
interface Node { ask: string; options: Option[] }
interface Result { title: string; why: string; tradeoffs: string[]; link?: string }
interface Scenario { id: string; scenario: string; options: { label: string; why: string }[]; answer: number }
interface Data { id: string; title: string; topic: string; reviewed: boolean; intro: string; start: string; nodes: Record<string, Node>; results: Record<string, Result>; scenarios: Scenario[] }

const base = document.documentElement.dataset.base || '/';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function mount(host: HTMLElement) {
  const progress = getProgress();
  const root = document.createElement('section');
  root.className = 'widget chooser';
  root.setAttribute('aria-label', 'Decision aid');
  host.replaceChildren(root);
  root.innerHTML = '<div class="quiz-body"><p class="ch-note">Loading…</p></div>';

  fetch(host.dataset.src!).then((r) => r.json() as Promise<Data>).then((d) => {
    type Mode = 'guide' | 'test';
    let mode: Mode = 'guide';
    let trail: { ask: string; label: string; node: string }[] = [];
    let node = d.start;
    let resultId: string | null = null;
    let n = 0;                       // scenario number
    let picks: (number | null)[] = d.scenarios.map(() => null);
    let finished = false;

    const head = `
      <div class="widget-head"><div><p class="eyebrow">Decision aid</p><h3>${esc(d.title)}</h3><p>${esc(d.intro)}</p></div>
        <div class="seg small" role="group" aria-label="Mode">
          <button type="button" data-mode="guide"><b>Guide me</b><small>answer questions</small></button>
          <button type="button" data-mode="test"><b>Test me</b><small>${d.scenarios.length} scenarios</small></button>
        </div></div>
      ${d.reviewed ? '' : '<p class="quiz-draft chooser-draft"><b>Draft.</b> This decision aid has not been checked by a second person yet.</p>'}`;

    const link = (r: Result) => (r.link ? `<a href="${esc(`${base}${d.topic}${r.link}`)}">Read the section</a>` : '');

    function guide(): string {
      if (resultId) {
        const r = d.results[resultId];
        return `<div class="quiz-body">
          <p class="quiz-count">${trail.map((t) => esc(t.label)).join(' › ')}</p>
          <h4 class="quiz-q" tabindex="-1" id="ch-focus">${esc(r.title)}</h4>
          <p class="ch-why">${esc(r.why)}</p>
          <div class="ch-costs"><b>What it costs you</b><ul>${r.tradeoffs.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
          <div class="quiz-actions"><button type="button" class="btn primary" data-act="restart">Start again</button>
            <button type="button" class="btn" data-act="back">Change my last answer</button> ${link(r)}</div>
        </div>`;
      }
      const q = d.nodes[node];
      return `<div class="quiz-body">
        ${trail.length ? `<p class="quiz-count">${trail.map((t) => esc(t.label)).join(' › ')}</p>` : '<p class="quiz-count">Question ' + (trail.length + 1) + '</p>'}
        <h4 class="quiz-q" tabindex="-1" id="ch-focus">${esc(q.ask)}</h4>
        <div class="quiz-choices" role="group" aria-labelledby="ch-focus">
          ${q.options.map((o, i) => `<button type="button" class="quiz-choice" data-opt="${i}"><kbd>${i + 1}</kbd><span>${esc(o.label)}</span></button>`).join('')}
        </div>
        ${trail.length ? '<div class="quiz-actions"><button type="button" class="chip-btn" data-act="back">Back</button></div>' : ''}
      </div>`;
    }

    function test(): string {
      if (finished) {
        const score = picks.filter((p, i) => p === d.scenarios[i].answer).length;
        return `<div class="quiz-body quiz-results">
          <p class="quiz-count">Results</p>
          <h4 class="quiz-score" tabindex="-1" id="ch-focus">${score} of ${d.scenarios.length}</h4>
          <ol class="quiz-review">${d.scenarios.map((s, i) => {
            const ok = picks[i] === s.answer;
            return `<li class="${ok ? 'ok' : 'bad'}"><span class="quiz-mark" aria-label="${ok ? 'Right' : 'Different from the best fit'}">${ok ? '✓' : '✗'}</span>
              <div><b>${esc(s.scenario)}</b>${ok ? '' : `<p>Best fit: ${esc(s.options[s.answer].label)}. ${esc(s.options[s.answer].why)}</p>`}</div></li>`;
          }).join('')}</ol>
          <div class="quiz-actions"><button type="button" class="btn primary" data-act="again">Try again</button></div>
        </div>`;
      }
      const s = d.scenarios[n];
      const chosen = picks[n];
      return `<div class="quiz-bar" role="progressbar" aria-label="Scenario progress" aria-valuemin="0" aria-valuemax="${d.scenarios.length}" aria-valuenow="${n}"><i style="width:${(n / d.scenarios.length) * 100}%"></i></div>
        <div class="quiz-body">
          <p class="quiz-count">Scenario ${n + 1} of ${d.scenarios.length}</p>
          <h4 class="quiz-q" tabindex="-1" id="ch-focus">${esc(s.scenario)}</h4>
          <p class="ch-note">Which would you reach for first?</p>
          <div class="quiz-choices" role="radiogroup" aria-labelledby="ch-focus">
            ${s.options.map((o, i) => {
              const cls = chosen === null ? '' : i === s.answer ? ' is-correct' : i === chosen ? ' is-wrong' : '';
              return `<button type="button" role="radio" class="quiz-choice${cls}" data-pick="${i}" aria-checked="${chosen === i}" ${chosen !== null ? 'aria-disabled="true"' : ''}><kbd>${i + 1}</kbd><span>${esc(o.label)}${chosen !== null ? `<small class="ch-opt-why">${esc(o.why)}</small>` : ''}</span>
                ${chosen !== null && i === s.answer ? '<em class="quiz-flag">Best fit</em>' : chosen === i ? '<em class="quiz-flag">Your pick</em>' : ''}</button>`;
            }).join('')}
          </div>
          ${chosen !== null ? `<div class="quiz-actions"><button type="button" class="btn primary" data-act="next">${n === d.scenarios.length - 1 ? 'See results' : 'Next scenario'} <kbd>Enter</kbd></button></div>` : ''}
        </div>`;
    }

    const render = (focus = true) => {
      root.innerHTML = head + (mode === 'guide' ? guide() : test());
      root.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
      if (focus) root.querySelector<HTMLElement>('#ch-focus')?.focus({ preventScroll: true });
    };

    function choose(i: number) {
      if (mode === 'guide') {
        const o = d.nodes[node].options[i];
        trail.push({ ask: d.nodes[node].ask, label: o.label, node });
        if (o.result) {
          resultId = o.result;
          progress.update((p) => { const c = p.choosers[d.id] ?? { guided: 0, attempts: [] }; c.guided += 1; p.choosers[d.id] = c; });
        } else node = o.next!;
      }
    }

    root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const m = t.closest<HTMLElement>('[data-mode]');
      const opt = t.closest<HTMLElement>('[data-opt]');
      const pick = t.closest<HTMLElement>('[data-pick]');
      const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
      if (m) { mode = m.dataset.mode as Mode; }
      else if (opt) choose(Number(opt.dataset.opt));
      else if (pick) { if (picks[n] === null) picks[n] = Number(pick.dataset.pick); }
      else if (act === 'restart') { trail = []; node = d.start; resultId = null; }
      else if (act === 'back') { const last = trail.pop(); if (last) { node = last.node; resultId = null; } }
      else if (act === 'next') {
        if (n < d.scenarios.length - 1) n++;
        else {
          finished = true;
          const score = picks.filter((p, i) => p === d.scenarios[i].answer).length;
          progress.update((p) => { const c = p.choosers[d.id] ?? { guided: 0, attempts: [] }; c.attempts = [...c.attempts, { score, of: d.scenarios.length, at: Date.now() }].slice(-50); p.choosers[d.id] = c; });
        }
      } else if (act === 'again') { n = 0; picks = d.scenarios.map(() => null); finished = false; }
      else return;
      render(!pick);
      if (pick) root.querySelector<HTMLElement>('[data-act="next"]')?.focus({ preventScroll: true });
    });

    root.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('a, input, select')) return;
      if (/^[1-9]$/.test(e.key)) {
        const i = Number(e.key) - 1;
        const btn = root.querySelector<HTMLElement>(mode === 'guide' ? `[data-opt="${i}"]` : `[data-pick="${i}"]`);
        if (btn) { e.preventDefault(); btn.click(); }
      } else if (e.key === 'Enter' && mode === 'test' && picks[n] !== null && !finished && !t.closest('[data-act]')) {
        e.preventDefault(); root.querySelector<HTMLElement>('[data-act="next"]')?.click();
      }
    });

    render(false);
  }).catch(() => { root.innerHTML = '<div class="quiz-body"><p class="ch-note">The decision aid could not be loaded. Reload the page to try again.</p></div>'; });
}
