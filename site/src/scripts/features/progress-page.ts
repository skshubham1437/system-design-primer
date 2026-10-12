// The /progress/ dashboard. The server renders a plain index of everything; this fills in your marks.
import { getProgress } from '../../lib/progress';
import { lastAttempts, nextUp, isRead, WEAK_BELOW } from '../../lib/next-up';
import { isDue, summarize } from '../../lib/srs';

interface Data {
  cardsTotal: number;
  groups: { id: string; label: string; pages: { path: string; title: string }[] }[];
  solutions: { path: string; title: string }[];
  quizzes: { slug: string; topic: string; title: string; ids: string[]; count: number }[];
  choosers?: { id: string; title: string; topic: string; scenarios: number }[];
}

const base = document.documentElement.dataset.base || '/';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const url = (p: string) => base + p;

function ring(done: number, total: number, label: string): string {
  const r = 26;
  const c = 2 * Math.PI * r;
  const frac = total ? done / total : 0;
  return `<svg class="ring" viewBox="0 0 64 64" role="img" aria-label="${esc(label)}: ${done} of ${total}">
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--line)" stroke-width="7"/>
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--hue)" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(c * frac).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 32 32)"/>
    <text x="32" y="37" text-anchor="middle" class="ring-n">${done}/${total}</text></svg>`;
}

export function mount(host: HTMLElement) {
  const raw = host.querySelector<HTMLScriptElement>('script[type="application/json"]');
  if (!raw) return;
  const data: Data = JSON.parse(raw.textContent || '{}');
  const progress = getProgress();
  const root = document.createElement('div');
  root.className = 'prog';
  host.replaceChildren(root);

  const render = () => {
    const doc = progress.get();
    const now = Date.now();
    const trail = data.groups.flatMap((g) => g.pages);
    const next = nextUp({ doc, now, trail, solutions: data.solutions, quizTopics: data.quizzes.map((q) => ({ slug: q.slug, topic: q.topic, title: q.title, ids: q.ids })) });
    const cards = summarize(Object.values(doc.cards).filter((c) => c.seen > 0), data.cardsTotal, now);
    const last = lastAttempts(doc);
    const planTicks = Object.values(doc.plan.done).reduce((n, a) => n + a.length, 0);
    const solStates: ("done" | "attempted" | "none")[] = data.solutions.map((s) => doc.solutions[s.path]?.status ?? 'none');
    const practised = (path: string) => Object.values(doc.solutions[path]?.notes ?? {}).filter((n) => n && n.trim()).length;
    const readCount = trail.filter((p) => isRead(doc, p.path)).length;
    const anything = readCount || Object.keys(doc.cards).length || doc.quiz.attempts.length || Object.keys(doc.solutions).length || planTicks;
    const cta = next.kind === 'read' ? 'Start reading' : next.kind === 'cards' ? 'Review cards' : next.kind === 'solution' ? 'Open the solution' : 'Go';

    root.innerHTML = `
      <section class="prog-next" aria-labelledby="pn">
        <p class="eyebrow" id="pn">Next up</p>
        <h2>${esc(next.title)}</h2>
        <p>${esc(next.detail)}</p>
        <a class="btn primary" href="${url(next.path)}">${cta}</a>
      </section>
      ${anything ? '' : '<p class="ch-note prog-empty">Nothing recorded yet. Read a topic, answer a quiz or review a flashcard and it will show up here. Everything stays in this browser.</p>'}

      <h2 class="prog-h">Topics read</h2>
      <div class="prog-rings">${data.groups.map((g) => {
        const done = g.pages.filter((p) => isRead(doc, p.path)).length;
        return `<div class="prog-ring group-${g.id}">${ring(done, g.pages.length, g.label)}<span>${esc(g.label)}</span></div>`;
      }).join('')}</div>

      <h2 class="prog-h">Flashcards</h2>
      <dl class="fc-stats prog-cards" aria-label="Flashcards">
        <div><dt>Due</dt><dd>${cards.due}</dd></div><div><dt>New</dt><dd>${cards.new}</dd></div>
        <div><dt>Learning</dt><dd>${cards.learning}</dd></div><div><dt>Mastered</dt><dd>${cards.mastered}</dd></div>
      </dl>
      <p><a href="${url('practice/flashcards/')}">Open flashcards</a></p>

      <h2 class="prog-h">Quizzes</h2>
      <ul class="prog-list">${data.quizzes.map((q) => {
        const a = last.get(q.slug);
        const weak = !!a && a.score / a.of < WEAK_BELOW;
        const dueQ = q.ids.filter((id) => doc.quiz.items[id]?.seen && isDue(doc.quiz.items[id], now)).length;
        return `<li class="${weak ? 'weak' : ''}"><a href="${url(q.topic)}">${esc(q.title)}</a>
          <span>${a ? `<b>${a.score} of ${a.of}</b>${weak ? ' · needs another look' : ''}` : `${q.count} questions, not taken`}${dueQ ? ` · ${dueQ} due` : ''}</span></li>`;
      }).join('') || '<li>No quizzes yet.</li>'}</ul>
      <p><a href="${url('quiz/')}">Take a mixed quiz</a></p>

      ${(data.choosers ?? []).length ? `<h2 class="prog-h">Decision aids</h2>
      <ul class="prog-list">${(data.choosers ?? []).map((c) => {
        const r = doc.choosers[c.id];
        const best = r?.attempts.length ? Math.max(...r.attempts.map((a) => a.score)) : null;
        return `<li><a href="${url(c.topic)}">${esc(c.title)}</a><span>${best !== null ? `best <b>${best} of ${c.scenarios}</b> on the scenarios` : `${c.scenarios} scenarios, not tried`}${r?.guided ? ` · guided ${r.guided} time${r.guided === 1 ? '' : 's'}` : ''}</span></li>`;
      }).join('')}</ul>` : ''}

      <h2 class="prog-h">Solutions</h2>
      <ul class="prog-list">${data.solutions.map((s, i) => `<li><a href="${url(s.path)}">${esc(s.title)}</a>${practised(s.path) ? `<span>${practised(s.path)} step${practised(s.path) === 1 ? '' : 's'} written up</span>` : ''}<span class="chip ${solStates[i]}">${solStates[i] === 'none' ? 'Not started' : solStates[i] === 'done' ? 'Done' : 'Attempted'}</span></li>`).join('')}</ul>

      <h2 class="prog-h">Study plan</h2>
      <p>${planTicks ? `${planTicks} item${planTicks === 1 ? '' : 's'} ticked${doc.plan.last ? ` on the ${doc.plan.last} plan` : ''}.` : 'No plan items ticked yet.'} <a href="${url('interview/study-guide/')}">Open the planner</a></p>

      <p class="ch-note">All of this is stored only in your browser. <a href="${url('about/')}">Export, import or reset it</a> from the About page.</p>`;
  };
  progress.subscribe(render);
  render();
}
