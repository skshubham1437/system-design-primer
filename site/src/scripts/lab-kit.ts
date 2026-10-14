// Small helpers shared by the interactive visuals.

export const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s);
export const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => [...r.querySelectorAll<T>(s)];
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function shell(host: HTMLElement, cls: string, label: string, head: { eyebrow: string; title: string; desc: string }, body: string): HTMLElement {
  const root = document.createElement('section');
  root.className = `widget lab vis ${cls}`;
  root.setAttribute('aria-label', label);
  root.innerHTML = `<div class="widget-head"><div><p class="eyebrow">${head.eyebrow}</p><h3>${head.title}</h3><p>${head.desc}</p></div></div>${body}`;
  host.replaceChildren(root);
  return root;
}

/** A repeating timer that can be started and stopped; stops itself when the widget leaves the page. */
export function ticker(root: HTMLElement, fn: () => void, ms: number) {
  let id: number | undefined;
  const stop = () => { if (id !== undefined) { clearInterval(id); id = undefined; } };
  const start = () => { stop(); id = window.setInterval(() => { if (!root.isConnected) { stop(); return; } fn(); }, ms); };
  return { start, stop, running: () => id !== undefined };
}

export interface PlayerOptions {
  /** Advance one step. Return false when there is nothing left to show; the player then pauses. */
  step: () => boolean | void;
  /** Put the animation back at its start. */
  reset: () => void;
  /** Milliseconds per step at 1× speed. */
  ms: number;
  /** Start playing on load unless the reader prefers reduced motion. */
  autoplay?: boolean;
  /** A short description of the current step, read out when stepping (not while playing, which would be noise). */
  describe?: () => string;
}

export interface Player { el: HTMLElement; play: () => void; pause: () => void; running: () => boolean; announce: () => void }

/**
 * Shared playback controls for every animation: play or pause, step, reset and speed.
 * Keyboard: the buttons work as usual; with focus anywhere in the bar, the right arrow steps and "k" plays or pauses.
 * With reduced motion the animation starts paused and is driven by the Step button.
 */
export function player(root: HTMLElement, o: PlayerOptions): Player {
  const el = document.createElement('div');
  el.className = 'player';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Playback');
  el.innerHTML = `
    <button type="button" class="btn primary" data-pl="toggle">Play</button>
    <button type="button" class="btn" data-pl="step">Step</button>
    <button type="button" class="chip-btn" data-pl="reset">Reset</button>
    <label class="player-speed">Speed <select data-pl="speed" aria-label="Playback speed">
      <option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option>
    </select></label>
    <span class="player-status sr-only" aria-live="polite"></span>`;
  let speed = 1;
  let id: number | undefined;
  const toggle = el.querySelector<HTMLButtonElement>('[data-pl="toggle"]')!;
  const status = el.querySelector<HTMLElement>('.player-status')!;
  const announce = () => { if (o.describe) status.textContent = o.describe(); };
  const pause = () => { if (id !== undefined) { clearInterval(id); id = undefined; } toggle.textContent = 'Play'; toggle.setAttribute('aria-pressed', 'false'); };
  const tick = () => { if (!root.isConnected) { pause(); return; } if (o.step() === false) pause(); };
  const play = () => { pause(); id = window.setInterval(tick, o.ms / speed); toggle.textContent = 'Pause'; toggle.setAttribute('aria-pressed', 'true'); };
  const stepOnce = () => { pause(); if (o.step() === false) pause(); announce(); };
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-pl]');
    if (!b) return;
    if (b.dataset.pl === 'toggle') (id === undefined ? play() : pause());
    else if (b.dataset.pl === 'step') stepOnce();
    else if (b.dataset.pl === 'reset') { const was = id !== undefined; pause(); o.reset(); announce(); if (was) play(); } // a running simulation keeps running from the start
  });
  el.querySelector('select')!.addEventListener('change', (e) => { speed = Number((e.target as HTMLSelectElement).value); if (id !== undefined) play(); });
  el.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'SELECT') return;
    if (e.key === 'ArrowRight') { e.preventDefault(); stepOnce(); }
    else if (e.key === 'k' || e.key === 'K') { e.preventDefault(); id === undefined ? play() : pause(); }
  });
  if (o.autoplay && !reducedMotion()) play();
  return { el, play, pause, running: () => id !== undefined, announce };
}
