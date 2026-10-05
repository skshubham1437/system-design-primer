// Spaced flashcards: due reviews first, a few new cards a day, graded Again / Good / Easy.
// Scheduling lives in lib/srs.ts and storage in lib/progress.ts; this file is only the interface.

import { getProgress } from '../../lib/progress';
import { grade, isDue, newItem, previewDays, startOfDay, summarize, type Grade, type SrsItem } from '../../lib/srs';

interface Card { front: string; back: string }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const dayWord = (n: number) => (n <= 0 ? 'now' : n === 1 ? 'tomorrow' : `${n} days`);

export function mount(host: HTMLElement) {
  const data = host.querySelector<HTMLScriptElement>('script[type="application/json"]');
  if (!data) return;
  const cards: Card[] = JSON.parse(data.textContent || '[]');
  if (!cards.length) return;
  const progress = getProgress();
  const titles = new Set(cards.map((c) => c.front));

  type Mode = 'study' | 'browse';
  let mode: Mode = 'study';
  let queue: string[] = [];
  let revealed = false;
  let browseIndex = 0;
  let extraNew = 0; // "learn some more today" allowance, session only
  const session = { reviewed: 0, correct: 0 };

  const root = document.createElement('section');
  root.className = 'widget flash';
  root.setAttribute('aria-label', 'Flashcards');
  host.replaceChildren(root);

  const byTitle = (t: string) => cards.find((c) => c.front === t)!;
  const items = () => Object.entries(progress.get().cards).filter(([t]) => titles.has(t));

  function newQuota(now: number): number {
    const d = progress.get().daily;
    const used = d.day === startOfDay(now) ? d.newCards : 0;
    return Math.max(0, progress.get().settings.newCardsPerDay + extraNew - used);
  }

  function buildQueue() {
    const now = Date.now();
    const state = progress.get().cards;
    const due = items().filter(([, i]) => i.seen > 0 && isDue(i, now)).sort((a, b) => a[1].due - b[1].due).map(([t]) => t);
    const fresh = cards.map((c) => c.front).filter((t) => !state[t]).slice(0, newQuota(now));
    queue = [...due, ...fresh];
    revealed = false;
  }

  function stats() {
    const now = Date.now();
    return summarize(items().map(([, i]) => i), cards.length, now);
  }

  function nextReview(): string {
    const now = Date.now();
    const upcoming = items().map(([, i]) => i).filter((i) => i.seen > 0 && !isDue(i, now)).sort((a, b) => a.due - b.due);
    if (!upcoming.length) return '';
    const days = Math.round((startOfDay(upcoming[0].due) - startOfDay(now)) / 86_400_000);
    const n = upcoming.filter((i) => startOfDay(i.due) === startOfDay(upcoming[0].due)).length;
    return `Next review ${dayWord(days)}: ${n} card${n === 1 ? '' : 's'}.`;
  }

  function head(s: ReturnType<typeof stats>): string {
    const perDay = progress.get().settings.newCardsPerDay;
    return `
      <div class="widget-head">
        <div><p class="eyebrow">Flashcards</p><h3>Study the concepts</h3>
        <p>${cards.length} cards from the Anki deck, scheduled so you see each one just before you would forget it.</p></div>
        <div class="fc-tools">
          <div class="seg small" role="group" aria-label="Mode">
            <button type="button" data-mode="study" aria-pressed="${mode === 'study'}"><b>Review</b></button>
            <button type="button" data-mode="browse" aria-pressed="${mode === 'browse'}"><b>Browse all</b></button>
          </div>
          <label class="fc-perday">New per day
            <select data-perday aria-label="New cards per day">${[5, 10, 20].map((n) => `<option value="${n}"${n === perDay ? ' selected' : ''}>${n}</option>`).join('')}</select>
          </label>
        </div>
      </div>
      <dl class="fc-stats" aria-label="Deck status">
        <div><dt>Due</dt><dd>${s.due}</dd></div><div><dt>New</dt><dd>${s.new}</dd></div>
        <div><dt>Learning</dt><dd>${s.learning}</dd></div><div><dt>Mastered</dt><dd>${s.mastered}</dd></div>
      </dl>`;
  }

  function foot(s: ReturnType<typeof stats>): string {
    const known = s.mastered;
    return `<div class="plan-foot"><div class="meter" role="progressbar" aria-label="Cards mastered" aria-valuemin="0" aria-valuemax="${cards.length}" aria-valuenow="${known}"><i style="width:${(known / cards.length) * 100}%"></i></div><span>${known} of ${cards.length} mastered</span>${progress.isPersistent() ? '' : '<span class="fc-warn">Not saved: this browser is blocking storage.</span>'}</div>`;
  }

  function renderStudy() {
    const s = stats();
    if (!queue.length) {
      const more = cards.some((c) => !progress.get().cards[c.front]);
      root.innerHTML = `${head(s)}
        <div class="fc-done"><h4>${session.reviewed ? 'Session complete' : 'All caught up'}</h4>
          <p>${session.reviewed ? `You reviewed ${session.reviewed} card${session.reviewed === 1 ? '' : 's'} and got ${Math.round((session.correct / session.reviewed) * 100)}% right.` : 'Nothing is due right now.'} ${esc(nextReview())}</p>
          ${more ? '<button type="button" class="btn" data-act="more">Learn 5 more new cards</button>' : ''}
        </div>${foot(s)}`;
      return;
    }
    const title = queue[0];
    const card = byTitle(title);
    const cur: SrsItem = progress.get().cards[title] ?? newItem(Date.now());
    const hints = previewDays(cur, Date.now());
    const isNew = !progress.get().cards[title];
    root.innerHTML = `${head(s)}
      <div class="fc-stage">
        <div class="fc-count">${queue.length} left this session${isNew ? ' · new card' : ''}</div>
        <article class="fc-card${revealed ? ' is-open' : ''}">
          <h4 class="fc-front">${esc(card.front)}</h4>
          ${revealed ? `<div class="fc-back prose">${card.back}</div>` : '<p class="fc-hint">Try to recall it first, then reveal.</p>'}
        </article>
        <div class="fc-actions">
          ${revealed
            ? `<button type="button" class="btn" data-grade="again">Again <small>now</small> <kbd>1</kbd></button>
               <button type="button" class="btn primary" data-grade="good">Good <small>${dayWord(hints.good)}</small> <kbd>2</kbd></button>
               <button type="button" class="btn" data-grade="easy">Easy <small>${dayWord(hints.easy)}</small> <kbd>3</kbd></button>`
            : '<button type="button" class="btn primary" data-act="show">Show answer <kbd>Space</kbd></button>'}
        </div>
      </div>${foot(s)}`;
  }

  function renderBrowse() {
    const s = stats();
    const card = cards[browseIndex];
    root.innerHTML = `${head(s)}
      <div class="fc-stage">
        <div class="fc-count">Card ${browseIndex + 1} of ${cards.length} · browsing does not affect your schedule</div>
        <article class="fc-card${revealed ? ' is-open' : ''}">
          <h4 class="fc-front">${esc(card.front)}</h4>
          ${revealed ? `<div class="fc-back prose">${card.back}</div>` : '<p class="fc-hint">Try to recall it first, then reveal.</p>'}
        </article>
        <div class="fc-actions">
          <button type="button" class="btn" data-act="prev" aria-label="Previous card">‹ Previous</button>
          <button type="button" class="btn primary" data-act="${revealed ? 'hide' : 'show'}">${revealed ? 'Hide answer' : 'Show answer'} <kbd>Space</kbd></button>
          <button type="button" class="btn" data-act="next" aria-label="Next card">Next ›</button>
        </div>
      </div>${foot(s)}`;
  }

  const render = () => (mode === 'study' ? renderStudy() : renderBrowse());

  function doGrade(g: Grade) {
    const title = queue[0];
    if (!title) return;
    const now = Date.now();
    const had = progress.get().cards[title];
    const next = grade(had ?? newItem(now), g, now);
    progress.update((d) => {
      d.cards[title] = next;
      if (!had) {
        const today = startOfDay(now);
        d.daily = d.daily.day === today ? { day: today, newCards: d.daily.newCards + 1 } : { day: today, newCards: 1 };
      }
    });
    session.reviewed++;
    if (g !== 'again') session.correct++;
    queue.shift();
    if (g === 'again') queue.push(title); // see it again before the session ends
    revealed = false;
  }

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const m = t.closest<HTMLElement>('[data-mode]');
    const g = t.closest<HTMLElement>('[data-grade]');
    const a = t.closest<HTMLElement>('[data-act]');
    if (m) { mode = m.dataset.mode as Mode; revealed = false; if (mode === 'study') buildQueue(); }
    else if (g) doGrade(g.dataset.grade as Grade);
    else if (a) {
      const act = a.dataset.act;
      if (act === 'show') revealed = true;
      else if (act === 'hide') revealed = false;
      else if (act === 'more') { extraNew += 5; buildQueue(); }
      else if (act === 'next') { browseIndex = (browseIndex + 1) % cards.length; revealed = false; }
      else if (act === 'prev') { browseIndex = (browseIndex - 1 + cards.length) % cards.length; revealed = false; }
    } else return;
    render();
    root.querySelector<HTMLElement>('.fc-actions .btn.primary, .fc-done .btn')?.focus({ preventScroll: true });
  });

  root.addEventListener('change', (e) => {
    const sel = (e.target as HTMLElement).closest<HTMLSelectElement>('[data-perday]');
    if (!sel) return;
    progress.update((d) => { d.settings.newCardsPerDay = Number(sel.value); });
    buildQueue();
    render();
  });

  root.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('a, select')) return;
    if (!revealed && e.key === ' ' && !t.closest('button')) { e.preventDefault(); revealed = true; render(); root.querySelector<HTMLElement>('.fc-actions .btn.primary')?.focus({ preventScroll: true }); }
    else if (mode === 'study' && revealed && ['1', '2', '3'].includes(e.key)) { doGrade((['again', 'good', 'easy'] as Grade[])[Number(e.key) - 1]); render(); root.querySelector<HTMLElement>('.fc-actions .btn.primary, .fc-done .btn')?.focus({ preventScroll: true }); }
  });

  buildQueue();
  render();
}
