// Interactive widgets. Each one enhances a server-rendered block in place; the
// original markup remains as the no-JS fallback.

const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => [...r.querySelectorAll<T>(s)];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const store = {
  get<T>(key: string, fallback: T): T {
    try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
  },
  set(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
};

function fallbackDetails(host: HTMLElement, label: string) {
  const original = host.firstElementChild as HTMLElement | null;
  if (!original) return;
  const d = document.createElement('details');
  d.className = 'widget-original';
  d.innerHTML = `<summary>${label}</summary>`;
  d.append(original);
  host.append(d);
}

/* ------------------------------------------------------------ study planner */
function studyPlanner(host: HTMLElement) {
  const rows = $$('tbody tr', host).map((tr) => {
    const cells = [...tr.children] as HTMLElement[];
    return { html: cells[0].innerHTML, levels: cells.slice(1).map((c) => c.textContent!.trim()) };
  });
  if (!rows.length) return;
  const timelines = [
    { id: 'short', label: 'Short', hint: 'a few days' },
    { id: 'medium', label: 'Medium', hint: 'a few weeks' },
    { id: 'long', label: 'Long', hint: 'a month +' },
  ];
  const KEY = 'primer:plan:v1';
  const state = store.get<{ done: Record<string, number[]>; last?: string }>(KEY, { done: {} });
  const fromHash = location.hash.slice(1);
  let current = timelines.some((t) => t.id === fromHash) ? fromHash : state.last && timelines.some((t) => t.id === state.last) ? state.last : 'medium';

  const root = document.createElement('section');
  root.className = 'widget planner';
  root.setAttribute('aria-label', 'Interview study planner');
  fallbackDetails(host, 'Show the original table');
  host.prepend(root);

  const render = () => {
    const ti = timelines.findIndex((t) => t.id === current);
    const done = new Set(state.done[current] ?? []);
    const idx = rows.map((_, i) => i);
    const total = idx.length;
    const count = idx.filter((i) => done.has(i)).length;
    root.innerHTML = `
      <div class="widget-head">
        <div><p class="eyebrow">Study planner</p><h3>Build your plan</h3><p>Pick how much time you have. Tick things off as you go; your progress stays in this browser.</p></div>
        <div class="seg" role="group" aria-label="Timeline">
          ${timelines.map((t) => `<button type="button" aria-pressed="${t.id === current}" data-t="${t.id}"><b>${t.label}</b><small>${t.hint}</small></button>`).join('')}
        </div>
      </div>
      <ol class="plan-list">
        ${rows.map((r, i) => {
          const level = r.levels[ti];
          const isCheck = level === '✓';
          const tag = isCheck ? 'Do all' : level;
          return `<li class="${done.has(i) ? 'is-done' : ''}" data-i="${i}">
            <input type="checkbox" id="plan-${i}" ${done.has(i) ? 'checked' : ''} aria-label="Mark done" />
            <span class="plan-text">${r.html}</span>
            <span class="tag ${isCheck ? 'all' : 'part'}" title="${isCheck ? 'Cover this fully' : 'How much of this to cover'}">${esc(tag)}</span>
          </li>`;
        }).join('')}
      </ol>
      <div class="plan-foot">
        <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${count}"><i style="width:${(count / total) * 100}%"></i></div>
        <span>${count} of ${total} done</span>
        ${count ? '<button type="button" class="link-btn" data-reset>Reset</button>' : ''}
      </div>`;
  };

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const seg = t.closest<HTMLElement>('[data-t]');
    if (seg) { current = seg.dataset.t!; state.last = current; store.set(KEY, state); history.replaceState(null, '', `#${current}`); render(); return; }
    if (t.closest('[data-reset]')) { state.done[current] = []; store.set(KEY, state); render(); return; }
    const li = t.closest<HTMLElement>('li[data-i]');
    if (!li || t.closest('a')) return;
    const i = Number(li.dataset.i);
    const set = new Set(state.done[current] ?? []);
    set.has(i) ? set.delete(i) : set.add(i);
    state.done[current] = [...set];
    store.set(KEY, state);
    render();
    $<HTMLInputElement>(`li[data-i="${i}"] input`, root)?.focus();
  });
  render();
}

/* ------------------------------------------------------------ latency explorer */
function formatNs(ns: number): string {
  if (ns < 1000) return `${+ns.toFixed(1)} ns`;
  if (ns < 1e6) return `${+(ns / 1e3).toFixed(1)} µs`;
  if (ns < 1e9) return `${+(ns / 1e6).toFixed(1)} ms`;
  return `${+(ns / 1e9).toFixed(1)} s`;
}
function humanScale(seconds: number): string {
  const r = (n: number) => (n >= 10 ? Math.round(n) : +n.toFixed(1));
  if (seconds < 60) return `${r(seconds)} sec`;
  if (seconds < 3600) { const m = Math.floor(seconds / 60); const s = Math.round(seconds % 60); return s ? `${m} min ${s} sec` : `${m} min`; }
  if (seconds < 86400) return `${r(seconds / 3600)} hours`;
  if (seconds < 86400 * 60) return `${r(seconds / 86400)} days`;
  if (seconds < 86400 * 365) return `${r(seconds / (86400 * 30.4))} months`;
  return `${r(seconds / (86400 * 365))} years`;
}

function latency(host: HTMLElement) {
  const text = $('pre', host)?.innerText ?? '';
  const rows: { name: string; ns: number; note: string }[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^(.+?)\s{2,}([\d,.]+)\s+ns\b(.*)$/);
    if (!m) continue;
    const note = m[3].match(/(\d+[xX] .*|~\S.*)$/)?.[1] ?? '';
    rows.push({ name: m[1].trim(), ns: parseFloat(m[2].replace(/,/g, '')), note });
  }
  if (rows.length < 5) return;
  const root = document.createElement('section');
  root.className = 'widget latency';
  root.setAttribute('aria-label', 'Latency numbers explorer');
  fallbackDetails(host, 'Show the original text table');
  host.prepend(root);

  const lo = Math.log10(rows[0].ns) - 0.4;
  const hi = Math.log10(rows[rows.length - 1].ns);
  const tone = (ns: number) => (ns < 1e3 ? 'cpu' : ns < 1e6 ? 'dc' : ns < 1e7 ? 'disk' : 'wan');
  let human = false;

  const render = () => {
    root.innerHTML = `
      <div class="widget-head">
        <div><p class="eyebrow">Explorer</p><h3>Feel the difference</h3><p>${human ? 'If one L1 cache reference took 1 second, here is how long everything else would take.' : 'Each bar is on a logarithmic scale: every step to the right is ten times slower.'}</p></div>
        <div class="seg" role="group" aria-label="Scale">
          <button type="button" aria-pressed="${!human}" data-h="0"><b>Real time</b><small>ns, µs, ms</small></button>
          <button type="button" aria-pressed="${human}" data-h="1"><b>Human scale</b><small>1 ns = 1 second</small></button>
        </div>
      </div>
      <ul class="lat-list">
        ${rows.map((r) => {
          const w = Math.max(2, ((Math.log10(r.ns) - lo) / (hi - lo)) * 100);
          return `<li><span class="lat-name">${esc(r.name)}${r.note ? `<small>${esc(r.note)}</small>` : ''}</span>
            <span class="lat-bar"><i class="${tone(r.ns)}" style="width:${w}%"></i></span>
            <span class="lat-val">${human ? humanScale(r.ns) : formatNs(r.ns)}</span></li>`;
        }).join('')}
      </ul>
      <div class="lat-legend"><span><i class="cpu"></i>CPU and memory</span><span><i class="dc"></i>SSD and datacenter</span><span><i class="disk"></i>Disk</span><span><i class="wan"></i>Across the world</span></div>`;
  };
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-h]');
    if (!b) return;
    human = b.dataset.h === '1';
    render();
  });
  render();
}

/* ------------------------------------------------------------ powers of two */
function powers(host: HTMLElement) {
  const root = document.createElement('section');
  root.className = 'widget powers';
  root.setAttribute('aria-label', 'Powers of two calculator');
  host.prepend(root);
  const names: [number, string][] = [[10, 'thousand'], [20, 'million'], [30, 'billion'], [40, 'trillion'], [50, 'quadrillion'], [60, 'quintillion']];
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
  let n = 20;

  const describe = (p: number) => {
    const v = 2n ** BigInt(p);
    const u = Math.floor(p / 10);
    const size = u === 0 ? `${v} bytes` : `${2 ** (p % 10)} ${units[u]}`;
    const near = [...names].reverse().find(([k]) => p >= k);
    const approx = near ? `${2 ** (p - near[0])} ${near[1]}` : p < 10 ? 'under a thousand' : '';
    return { exact: v.toLocaleString('en-US'), size, approx };
  };

  const render = () => {
    const d = describe(n);
    root.innerHTML = `
      <div class="widget-head"><div><p class="eyebrow">Calculator</p><h3>2<sup>${n}</sup> is…</h3></div></div>
      <div class="pow-body">
        <div class="pow-big"><b>${d.exact}</b><span>exact value</span></div>
        <dl class="pow-facts">
          <div><dt>As a size</dt><dd>${d.size}</dd></div>
          <div><dt>Roughly</dt><dd>${d.approx || '–'}</dd></div>
          <div><dt>Bits needed</dt><dd>${n}</dd></div>
        </dl>
      </div>
      <div class="pow-control">
        <input type="range" min="0" max="64" value="${n}" aria-label="Power of two" />
        <div class="pow-chips">${[7, 8, 10, 16, 20, 30, 32, 40, 64].map((p) => `<button type="button" class="chip-btn" data-p="${p}" aria-pressed="${p === n}">2<sup>${p}</sup></button>`).join('')}</div>
      </div>`;
  };
  root.addEventListener('input', (e) => { const el = e.target as HTMLInputElement; if (el.type === 'range') { n = Number(el.value); render(); $<HTMLInputElement>('input[type=range]', root)?.focus(); } });
  root.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-p]'); if (b) { n = Number(b.dataset.p); render(); } });
  render();
}

/* ------------------------------------------------------------ availability (nines) */
function duration(sec: number): string {
  if (sec < 60) return `${+sec.toFixed(1)}s`;
  if (sec < 3600) { const m = Math.floor(sec / 60); return `${m}m ${+(sec - m * 60).toFixed(1)}s`; }
  const h = Math.floor(sec / 3600); const m = Math.floor((sec - h * 3600) / 60); const s = Math.round(sec - h * 3600 - m * 60);
  return `${h}h ${m}m ${s}s`;
}
const pct = (a: number) => {
  const s = (a * 100).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return `${s}%`;
};

function nines(host: HTMLElement) {
  const root = document.createElement('section');
  root.className = 'widget nines';
  root.setAttribute('aria-label', 'Availability calculator');
  host.append(root);
  let target = 99.9;
  let mode: 'series' | 'parallel' = 'series';
  let comps = [99.9, 99.9];
  const presets = [99, 99.5, 99.9, 99.95, 99.99, 99.999];
  const clamp = (v: number) => Math.min(100, Math.max(0, isNaN(v) ? 0 : v));

  const compose = () => {
    const a = comps.map((c) => clamp(c) / 100);
    return mode === 'series' ? a.reduce((x, y) => x * y, 1) : 1 - a.reduce((x, y) => x * (1 - y), 1);
  };

  const render = () => {
    const down = 1 - clamp(target) / 100;
    const total = compose();
    root.innerHTML = `
      <div class="widget-head"><div><p class="eyebrow">Calculator</p><h3>What do the nines really cost?</h3><p>See how much downtime an availability target allows, then combine components to see what you actually get.</p></div></div>
      <div class="nines-grid">
        <div class="panel">
          <h4>Downtime budget</h4>
          <div class="pow-chips">${presets.map((p) => `<button type="button" class="chip-btn" data-preset="${p}" aria-pressed="${p === target}">${p}%</button>`).join('')}</div>
          <label class="field"><span>Availability</span><input type="number" step="any" min="0" max="100" value="${target}" data-target /><em>%</em></label>
          <table class="mini"><tbody>
            ${([['per day', 86400], ['per week', 604800], ['per month', 2629800], ['per year', 31557600]] as [string, number][]).map(([l, s]) => `<tr><th>${l}</th><td>${duration(down * s)}</td></tr>`).join('')}
          </tbody></table>
        </div>
        <div class="panel">
          <h4>Combine components</h4>
          <div class="seg small" role="group" aria-label="Arrangement">
            <button type="button" aria-pressed="${mode === 'series'}" data-mode="series"><b>In sequence</b></button>
            <button type="button" aria-pressed="${mode === 'parallel'}" data-mode="parallel"><b>In parallel</b></button>
          </div>
          <div class="comp-list">
            ${comps.map((c, i) => `<label class="field"><span>Component ${i + 1}</span><input type="number" step="any" min="0" max="100" value="${c}" data-comp="${i}" /><em>%</em>${comps.length > 2 ? `<button type="button" class="link-btn" data-del="${i}" aria-label="Remove component ${i + 1}">Remove</button>` : ''}</label>`).join('')}
          </div>
          <button type="button" class="link-btn" data-add ${comps.length >= 6 ? 'disabled' : ''}>+ Add component</button>
          <div class="result"><b>${pct(total)}</b><span>${mode === 'series' ? 'Every component must be up, so availability drops.' : 'Only one component must be up, so availability rises.'} About ${duration((1 - total) * 31557600)} of downtime per year.</span></div>
        </div>
      </div>`;
  };

  const keepFocus = (sel: string, pos: number | null) => {
    const el = $<HTMLInputElement>(sel, root);
    if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { /* number inputs */ } }
  };
  root.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.target !== undefined) { target = parseFloat(el.value); render(); keepFocus('[data-target]', null); }
    else if (el.dataset.comp !== undefined) { const i = Number(el.dataset.comp); comps[i] = parseFloat(el.value); render(); keepFocus(`[data-comp="${i}"]`, null); }
  });
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const preset = t.closest<HTMLElement>('[data-preset]');
    const m = t.closest<HTMLElement>('[data-mode]');
    if (preset) target = Number(preset.dataset.preset);
    else if (m) mode = m.dataset.mode as typeof mode;
    else if (t.closest('[data-add]') && comps.length < 6) comps.push(99.9);
    else if (t.closest('[data-del]')) comps.splice(Number(t.closest<HTMLElement>('[data-del]')!.dataset.del), 1);
    else return;
    render();
  });
  render();
}

/* ------------------------------------------------------------ flashcards */
function flashcards(host: HTMLElement) {
  const data = $<HTMLScriptElement>('script[type="application/json"]', host);
  if (!data) return;
  const cards: { front: string; back: string }[] = JSON.parse(data.textContent || '[]');
  if (!cards.length) return;
  const KEY = 'primer:cards:v1';
  const saved = store.get<{ known: string[] }>(KEY, { known: [] });
  const known = new Set(saved.known.filter((k) => cards.some((c) => c.front === k)));
  let queue: number[] = [];
  let revealed = false;

  const root = document.createElement('section');
  root.className = 'widget flash';
  root.setAttribute('aria-label', 'Flashcards');
  host.replaceChildren(root);

  const build = (shuffle = false) => {
    queue = cards.map((_, i) => i).filter((i) => !known.has(cards[i].front));
    if (shuffle) for (let i = queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [queue[i], queue[j]] = [queue[j], queue[i]]; }
    revealed = false;
  };
  const persist = () => store.set(KEY, { known: [...known] });

  const render = () => {
    const total = cards.length;
    const head = `
      <div class="widget-head">
        <div><p class="eyebrow">Flashcards</p><h3>Study the concepts</h3><p>${total} cards from the Anki deck. Reveal the answer, then mark whether you knew it.</p></div>
        <div class="fc-tools"><button type="button" class="chip-btn" data-act="shuffle">Shuffle</button><button type="button" class="chip-btn" data-act="reset">Reset progress</button></div>
      </div>`;
    const foot = `<div class="plan-foot"><div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${known.size}"><i style="width:${(known.size / total) * 100}%"></i></div><span>${known.size} of ${total} known</span></div>`;
    if (!queue.length) {
      root.innerHTML = `${head}<div class="fc-done"><h4>All ${total} cards known</h4><p>Nicely done. Reset your progress to go round again.</p><button type="button" class="btn primary" data-act="reset">Start over</button></div>${foot}`;
      return;
    }
    const c = cards[queue[0]];
    root.innerHTML = `${head}
      <div class="fc-stage">
        <div class="fc-count">${queue.length} left in this round</div>
        <article class="fc-card${revealed ? ' is-open' : ''}">
          <h4 class="fc-front">${esc(c.front)}</h4>
          ${revealed ? `<div class="fc-back prose">${c.back}</div>` : '<p class="fc-hint">Try to recall it first, then reveal.</p>'}
        </article>
        <div class="fc-actions">
          ${revealed
            ? '<button type="button" class="btn" data-act="again">Review again <kbd>1</kbd></button><button type="button" class="btn primary" data-act="know">I knew it <kbd>2</kbd></button>'
            : '<button type="button" class="btn primary" data-act="show">Show answer <kbd>Space</kbd></button>'}
        </div>
      </div>${foot}`;
  };

  const act = (a: string) => {
    if (a === 'show') revealed = true;
    else if (a === 'again') { queue.push(queue.shift()!); revealed = false; }
    else if (a === 'know') { known.add(cards[queue.shift()!].front); persist(); revealed = false; }
    else if (a === 'shuffle') build(true);
    else if (a === 'reset') { known.clear(); persist(); build(); }
    render();
    root.querySelector<HTMLElement>('.fc-actions .btn.primary, .fc-done .btn')?.focus({ preventScroll: true });
  };
  root.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]'); if (b) act(b.dataset.act!); });
  root.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (!queue.length || t.closest('a')) return;
    if (!revealed && e.key === ' ' && !t.closest('button')) { e.preventDefault(); act('show'); }
    else if (revealed && e.key === '1') act('again');
    else if (revealed && e.key === '2') act('know');
  });
  build();
  render();
}

const widgets: Record<string, (host: HTMLElement) => void> = { 'study-planner': studyPlanner, latency, powers, nines, flashcards };
const LAB_TYPES = ['estimator', 'consistent-hash', 'cache-eviction', 'load-balancing', 'cap-lab'];
$$('[data-widget]').forEach((host) => {
  const type = host.dataset.widget!;
  try {
    if (LAB_TYPES.includes(type)) {
      // labs are the heaviest scripts, so they load only on the pages that use them
      import('./labs.ts').then((m) => m.labWidgets[type](host)).catch((err) => console.error('lab failed', type, err));
    } else widgets[type]?.(host);
  } catch (err) { console.error('widget failed', type, err); }
});
