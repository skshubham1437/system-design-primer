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
