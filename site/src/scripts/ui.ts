const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => [...r.querySelectorAll<T>(s)];
const base = document.documentElement.dataset.base || '/';

/* ------------------------------------------------------------ theme + nav */
$('#theme-toggle')?.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch {}
});

const closeNav = () => document.body.classList.remove('nav-open');
$('#menu-btn')?.addEventListener('click', () => document.body.classList.toggle('nav-open'));
$('#drawer-close')?.addEventListener('click', closeNav);
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNav(); });
addEventListener('resize', () => { if (innerWidth > 960) closeNav(); });

/* ------------------------------------------------------------ diagrams: dark-mode colour switch */
$$('.figure').forEach((fig) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fig-toggle';
  const sync = () => {
    const original = document.documentElement.dataset.diagrams === 'original';
    btn.textContent = original ? 'Adapt to dark' : 'Original colours';
    btn.setAttribute('aria-pressed', String(original));
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const root = document.documentElement;
    if (root.dataset.diagrams === 'original') delete root.dataset.diagrams;
    else root.dataset.diagrams = 'original';
    try { localStorage.setItem('diagrams', root.dataset.diagrams ?? 'adapted'); } catch {}
    $$('.fig-toggle').forEach((b) => b.dispatchEvent(new Event('sync')));
  });
  btn.addEventListener('sync', sync);
  sync();
  fig.append(btn);
});
$('#sidebar')?.addEventListener('click', (e) => { if ((e.target as Element).closest('a')) closeNav(); });
document.addEventListener('click', (e) => {
  if (document.body.classList.contains('nav-open') && !(e.target as Element).closest('#sidebar, #menu-btn')) closeNav();
});

// keep the active sidebar link in view
const sidebar = $('#sidebar');
const active = $('.nav-link[aria-current="page"]');
if (sidebar && active) sidebar.scrollTop = Math.max(0, active.offsetTop - sidebar.clientHeight / 2);

/* ------------------------------------------------------------ reading progress */
const bar = $('#progress-bar');
const article = $('article.article');
if (bar && article) {
  let ticking = false;
  const update = () => {
    const r = article.getBoundingClientRect();
    const total = r.height - window.innerHeight * 0.6;
    const done = Math.min(1, Math.max(0, -r.top / Math.max(total, 1)));
    bar.style.transform = `scaleX(${done})`;
    ticking = false;
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  update();
}

/* ------------------------------------------------------------ TOC scroll-spy */
const tocLinks = $$<HTMLAnchorElement>('.toc a[data-toc]');
if (tocLinks.length) {
  const map = new Map(tocLinks.map((a) => [a.dataset.toc!, a]));
  const targets = [...map.keys()].map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
  const setActive = (id: string) => {
    tocLinks.forEach((a) => a.classList.toggle('active', a.dataset.toc === id));
    map.get(id)?.scrollIntoView({ block: 'nearest' });
  };
  const io = new IntersectionObserver((entries) => {
    const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (visible[0]) setActive(visible[0].target.id);
  }, { rootMargin: '-72px 0px -72% 0px' });
  targets.forEach((t) => io.observe(t));
}

/* ------------------------------------------------------------ code copy */
document.addEventListener('click', async (e) => {
  const btn = (e.target as Element).closest<HTMLButtonElement>('.copy-btn');
  if (!btn) return;
  const code = btn.closest('.code-block')?.querySelector('pre')?.innerText ?? '';
  try {
    await navigator.clipboard.writeText(code.replace(/\n$/, ''));
    btn.textContent = 'Copied';
    btn.classList.add('done');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('done'); }, 1600);
  } catch { btn.textContent = 'Press Ctrl+C'; }
});

/* ------------------------------------------------------------ lightbox */
const lightbox = $<HTMLDialogElement>('#lightbox');
document.addEventListener('click', (e) => {
  const img = (e.target as Element).closest<HTMLImageElement>('.figure img');
  if (!img || !lightbox) return;
  const big = $<HTMLImageElement>('img', lightbox)!;
  big.src = img.currentSrc || img.src;
  big.alt = img.alt;
  lightbox.showModal();
});
lightbox?.addEventListener('click', () => lightbox.close());

/* ------------------------------------------------------------ search */
interface Entry { t: string; p: string; g: string; b: string; h: { id: string; text: string }[] }
interface Hit { title: string; sub: string; url: string; html?: boolean }

const dialog = $<HTMLDialogElement>('#search')!;
const input = $<HTMLInputElement>('#search-input')!;
const results = $('#search-results')!;
let entries: Entry[] | null = null;
let pagefind: any;
let selected = 0;
let seq = 0;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const abs = (u: string) => (u.startsWith(base) ? u : base + u.replace(/^\//, ''));

async function loadIndex() {
  if (entries) return entries;
  try { entries = await (await fetch(base + 'search-index.json')).json(); } catch { entries = []; }
  return entries!;
}
async function loadPagefind() {
  if (pagefind !== undefined) return pagefind;
  try { pagefind = await import(/* @vite-ignore */ base + 'pagefind/pagefind.js'); } catch { pagefind = null; }
  return pagefind;
}

function localSearch(q: string, all: Entry[]): { pages: Hit[]; sections: Hit[] } {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const pages: { s: number; hit: Hit }[] = [];
  const sections: { s: number; hit: Hit }[] = [];
  for (const e of all) {
    const title = e.t.toLowerCase();
    const hay = `${title} ${e.b.toLowerCase()}`;
    if (words.every((w) => hay.includes(w))) {
      const s = title.startsWith(words[0]) ? 100 : words.every((w) => title.includes(w)) ? 60 : 10;
      pages.push({ s, hit: { title: e.t, sub: e.g + ' · ' + e.b, url: abs(e.p) } });
    }
    for (const h of e.h) {
      const ht = h.text.toLowerCase();
      if (words.every((w) => ht.includes(w))) sections.push({ s: ht.startsWith(words[0]) ? 50 : 30, hit: { title: h.text, sub: e.t, url: abs(e.p) + '#' + h.id } });
    }
  }
  const top = (a: typeof pages, n: number) => a.sort((x, y) => y.s - x.s).slice(0, n).map((x) => x.hit);
  return { pages: top(pages, 6), sections: top(sections, 8) };
}

function render(groups: { label: string; hits: Hit[] }[]) {
  const flat = groups.flatMap((g) => g.hits);
  if (!flat.length) { results.innerHTML = '<div class="search-empty">No matches. Try a broader term like “cache” or “sharding”.</div>'; return; }
  let i = 0;
  results.innerHTML = groups.filter((g) => g.hits.length).map((g) =>
    `<h3>${esc(g.label)}</h3>` + g.hits.map((h) =>
      `<a class="result" role="option" href="${esc(h.url)}" data-i="${i++}"><b>${esc(h.title)}</b><span>${h.html ? h.sub : esc(h.sub)}</span></a>`).join('')
  ).join('');
  selected = 0;
  mark();
}
function mark() {
  $$('.result', results).forEach((r) => {
    const on = Number(r.dataset.i) === selected;
    r.setAttribute('aria-selected', String(on));
    if (on) r.scrollIntoView({ block: 'nearest' });
  });
}

async function run() {
  const q = input.value.trim();
  const my = ++seq;
  const all = await loadIndex();
  if (!q) {
    render([{ label: 'Jump to', hits: all.slice(0, 12).map((e) => ({ title: e.t, sub: e.g, url: abs(e.p) })) }]);
    return;
  }
  const local = localSearch(q, all);
  render([{ label: 'Pages', hits: local.pages }, { label: 'Sections', hits: local.sections }]);
  const pf = await loadPagefind();
  if (!pf || my !== seq) return;
  const found = await pf.search(q);
  const datas = await Promise.all(found.results.slice(0, 6).map((r: any) => r.data()));
  if (my !== seq) return;
  const seen = new Set([...local.pages, ...local.sections].map((h) => h.url));
  const text: Hit[] = datas.map((d: any) => {
    const sub = d.sub_results?.[0];
    return { title: (sub?.title && sub.title !== d.meta.title ? `${d.meta.title} — ${sub.title}` : d.meta.title) || 'Untitled', sub: sub?.excerpt || d.excerpt, url: abs(sub?.url || d.url), html: true };
  }).filter((h: Hit) => !seen.has(h.url));
  render([{ label: 'Pages', hits: local.pages }, { label: 'Sections', hits: local.sections }, { label: 'In the text', hits: text }]);
}

function openSearch() {
  if (!dialog.open) dialog.showModal();
  input.select();
  run();
}
$('#search-open')?.addEventListener('click', openSearch);
$$('[data-search-open]').forEach((b) => b.addEventListener('click', openSearch));
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
input.addEventListener('input', run);
input.addEventListener('keydown', (e) => {
  const n = $$('.result', results).length;
  if (e.key === 'ArrowDown') { e.preventDefault(); selected = (selected + 1) % Math.max(n, 1); mark(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); selected = (selected - 1 + n) % Math.max(n, 1); mark(); }
  else if (e.key === 'Enter') { const r = $<HTMLAnchorElement>(`.result[data-i="${selected}"]`, results); if (r) { dialog.close(); location.href = r.href; } }
});
results.addEventListener('click', () => dialog.close());
addEventListener('keydown', (e) => {
  const typing = /input|textarea|select/i.test((e.target as Element).tagName);
  if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); openSearch(); }
});
if (/Mac|iPhone|iPad/.test(navigator.platform)) { const k = $('#search-kbd'); if (k) k.textContent = '⌘ K'; }

/* ------------------------------------------------------------ interactive widgets */
if (document.querySelector('[data-widget]')) import('./widgets.ts');
