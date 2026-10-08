// Runs on every page with the sidebar: marks pages as read in the navigation and records reading.
// Rules for "read" live in lib/reading.ts.

import { getProgress, type ProgressStore } from '../../lib/progress';
import { partialPct, shouldMarkRead } from '../../lib/reading';

function marks(progress: ProgressStore) {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.nav-link[data-path]')];
  const words: Record<string, string> = { done: 'done', attempted: 'attempted', read: 'read', partial: 'partly read' };
  const apply = () => {
    const doc = progress.get();
    for (const a of links) {
      const path = a.dataset.path!;
      const status = doc.solutions[path]?.status;
      const pct = doc.read[path]?.pct ?? 0;
      const state = status === 'done' ? 'done' : status === 'attempted' ? 'attempted' : pct >= 100 ? 'read' : pct > 0 ? 'partial' : '';
      let mark = a.querySelector<HTMLElement>('.read-mark');
      if (!state) { mark?.remove(); a.removeAttribute('data-state'); continue; }
      if (!mark) { mark = document.createElement('span'); mark.className = 'read-mark'; a.append(mark); }
      a.dataset.state = state;
      mark.innerHTML = `<span class="sr-only"> (${words[state]})</span>`;
    }
  };
  apply();
  progress.subscribe(apply);
}

function trackReading(progress: ProgressStore) {
  const article = document.querySelector<HTMLElement>('article.article[data-track]');
  if (!article) return;
  const path = article.dataset.track!;
  const minutes = Number(article.dataset.minutes) || 1;
  if ((progress.get().read[path]?.pct ?? 0) >= 100) return;

  let visibleMs = 0;
  let endSeen = false;
  let maxFraction = 0;
  let stored = progress.get().read[path]?.pct ?? 0;

  const end = article.querySelector('.pager') ?? article.lastElementChild;
  if (end) new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) endSeen = true; }).observe(end);

  let ticking = false;
  const measure = () => {
    const r = article.getBoundingClientRect();
    const seen = Math.min(r.height, Math.max(0, window.innerHeight - r.top));
    maxFraction = Math.max(maxFraction, r.height ? seen / r.height : 0);
    ticking = false;
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(measure); } }, { passive: true });
  measure();

  const timer = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    visibleMs += 1000;
    if (visibleMs % 5000 !== 0) return;
    if (shouldMarkRead({ endSeen, visibleMs, minutes })) {
      progress.update((d) => { d.read[path] = { at: Date.now(), pct: 100 }; });
      clearInterval(timer);
      return;
    }
    const pct = partialPct(maxFraction);
    if (pct >= stored + 10) { stored = pct; progress.update((d) => { d.read[path] = { at: Date.now(), pct }; }); }
  }, 1000);
}

export function init() {
  const progress = getProgress();
  marks(progress);
  trackReading(progress);
}
