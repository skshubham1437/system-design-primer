// Animations for the Databases section: a B+tree, three scan types, a composite index and a plan stepper.
// The logic lives in src/lib/db/* (pure and tested); this file only draws it and wires up the controls.
import { $, $$, esc, player, shell } from './lab-kit';
import { build, insert, search, range, layout, height, type BStep, type BTree } from '../lib/db/btree';
import { makeTable, scanSteps, finalCounts, PAGES, PER_PAGE, type ScanKind, type ScanStep } from '../lib/db/scans';
import { makeEntries, QUERIES, usage, COUNTRIES } from '../lib/db/composite';
import { planSteps, hottest, nodeName, NODE_HELP, type PlanStep } from '../lib/db/plan-steps';
import type { PlanNode } from '../lib/db/checks';
import { joinSteps, OUTER, INNER, type JoinAlgo, type JoinStep } from '../lib/db/joins';
import { sessionsAt, locksAt, type Trace, type TraceEvent } from '../lib/db/traces';

const fmt = (n: number, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d });

/* ------------------------------------------------------------ B+tree */

function btree(host: HTMLElement) {
  const START = [10, 20, 30, 40, 50, 60, 70, 80, 90, 25, 55];
  let tree: BTree = build(START);
  let frames: BStep[] = [{ tree, focus: [], note: 'Each box is one index page. Pick an operation below.' }];
  let at = 0;
  const root = shell(host, 'v-btree', 'B-tree index', { eyebrow: 'Animation', title: 'Inside a B-tree index', desc: 'Pages hold a few sorted keys. Inner pages point down to the page that covers a key; leaf pages hold every key and link to their neighbour. Real pages hold hundreds of keys, so even a huge index is only three or four levels deep.' }, `
    <div class="vis-controls bt-controls">
      <label class="lab-field inline"><span>Key</span><div class="lab-input"><input type="number" id="bt-key" value="35" min="1" max="999" inputmode="numeric" /></div></label>
      <button type="button" class="btn" data-op="search">Search</button>
      <button type="button" class="btn" data-op="insert">Insert</button>
      <span class="bt-sep" aria-hidden="true"></span>
      <label class="lab-field inline"><span>From</span><div class="lab-input"><input type="number" id="bt-lo" value="22" inputmode="numeric" /></div></label>
      <label class="lab-field inline"><span>to</span><div class="lab-input"><input type="number" id="bt-hi" value="58" inputmode="numeric" /></div></label>
      <button type="button" class="btn" data-op="range">Range scan</button>
      <button type="button" class="chip-btn" data-op="fill">Insert 8 more in a row</button>
      <button type="button" class="chip-btn" data-op="restart">Start over</button>
    </div>
    <div class="vis-actions" id="bt-play"></div>
    <div class="bt-stage" tabindex="0" role="region" aria-label="Index pages (scrolls sideways on small screens)"><svg id="bt-svg" role="img"></svg></div>
    <p class="vis-status" id="bt-note" aria-live="off"></p>
    <dl class="vis-stats" id="bt-stats"></dl>`);

  const draw = () => {
    const f = frames[at];
    const KW = 30, LH = 74, PAD = 12;
    const lay = layout(f.tree, { keyW: KW, gap: 16, levelH: LH });
    const W = lay.width + PAD * 2, H = lay.height - LH + 34 + PAD * 2;
    const svg = $('#bt-svg', root)!;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.style.minWidth = `${Math.min(W, 900)}px`;
    const byId = new Map(lay.nodes.map((n) => [n.id, n]));
    const focus = new Set(f.focus), hit = new Set(f.hit ?? []);
    const edges = lay.edges.map(([a, b]) => {
      const p = byId.get(a)!, c = byId.get(b)!;
      return `<line x1="${PAD + p.x + p.w / 2}" y1="${PAD + p.y + 34}" x2="${PAD + c.x + c.w / 2}" y2="${PAD + c.y}" class="bt-edge"/>`;
    }).join('');
    const leaves = lay.nodes.filter((n) => n.leaf).sort((a, b) => a.x - b.x);
    const links = leaves.slice(1).map((n, i) => { const p = leaves[i]; return `<line x1="${PAD + p.x + p.w}" y1="${PAD + p.y + 17}" x2="${PAD + n.x}" y2="${PAD + n.y + 17}" class="bt-link"/>`; }).join('');
    const boxes = lay.nodes.map((n) => `
      <g class="bt-node${focus.has(n.id) ? ' on' : ''}${n.leaf ? ' leaf' : ''}">
        <rect x="${PAD + n.x}" y="${PAD + n.y}" width="${n.w}" height="34" rx="7"/>
        ${n.keys.map((k, i) => `<text x="${PAD + n.x + 4 + i * KW + KW / 2}" y="${PAD + n.y + 22}" text-anchor="middle" class="${hit.has(k) && n.leaf ? 'hit' : ''}">${k}</text>`).join('')}
      </g>`).join('');
    svg.innerHTML = edges + links + boxes;
    svg.setAttribute('aria-label', `B-tree with ${height(f.tree)} level${height(f.tree) === 1 ? '' : 's'} and ${lay.nodes.filter((n) => n.leaf).length} leaf pages.`);
    $('#bt-note', root)!.textContent = f.note;
    $('#bt-stats', root)!.innerHTML = `<div><dt>Step</dt><dd>${at + 1} / ${frames.length}</dd></div><div><dt>Levels</dt><dd>${height(f.tree)}</dd></div><div><dt>Pages</dt><dd>${lay.nodes.length}</dd></div><div><dt>Keys</dt><dd>${lay.nodes.filter((n) => n.leaf).reduce((s, n) => s + n.keys.length, 0)}</dd></div>`;
  };
  const pl = player(root, {
    ms: 1100,
    step: () => { if (at >= frames.length - 1) return false; at++; draw(); return at < frames.length - 1; },
    reset: () => { at = 0; draw(); },
    describe: () => frames[at].note,
  });
  $('#bt-play', root)!.append(pl.el);
  const run = (fr: BStep[]) => { frames = fr.length ? fr : frames; at = 0; draw(); pl.announce(); if (frames.length > 1) pl.play(); };
  const val = (id: string) => Math.round(Number(($(id, root) as HTMLInputElement).value));
  root.addEventListener('click', (e) => {
    const op = (e.target as HTMLElement).closest<HTMLElement>('[data-op]')?.dataset.op;
    if (!op) return;
    if (op === 'search') run(search(tree, val('#bt-key')));
    else if (op === 'insert') { const r = insert(tree, val('#bt-key')); tree = r.tree; run(r.steps); }
    else if (op === 'range') { const lo = Math.min(val('#bt-lo'), val('#bt-hi')), hi = Math.max(val('#bt-lo'), val('#bt-hi')); run(range(tree, lo, hi)); }
    else if (op === 'fill') {
      const top = Math.max(...Object.values(tree.nodes).flatMap((n) => n.keys));
      const all: BStep[] = [];
      for (let k = top + 1; k <= top + 8; k++) { const r = insert(tree, k); tree = r.tree; all.push(r.steps[r.steps.length - 1]); }
      all.push({ tree, focus: [], note: 'Keys that always arrive in increasing order, like ids or timestamps, all land in the rightmost leaf, which keeps splitting. PostgreSQL handles this case well, but it is why that last page is the busiest.' });
      run(all);
    } else if (op === 'restart') { tree = build(START); run([{ tree, focus: [], note: 'Back to the starting tree.' }]); }
  });
  draw();
}

/* ------------------------------------------------------------ scan types */

function scanCompare(host: HTMLElement) {
  const table = makeTable();
  const RANGES = { narrow: { lo: 10, hi: 12, label: 'Rare: value 10 to 12' }, wide: { lo: 1, hi: 40, label: 'Common: value 1 to 40' } } as const;
  const KINDS: { id: ScanKind; label: string }[] = [{ id: 'seq', label: 'Sequential scan' }, { id: 'index', label: 'Index scan' }, { id: 'bitmap', label: 'Bitmap scan' }];
  let which: keyof typeof RANGES = 'narrow';
  let kind: ScanKind = 'seq';
  let steps: ScanStep[] = [];
  let at = 0;
  const root = shell(host, 'v-scans', 'Scan types', { eyebrow: 'Animation', title: 'Three ways to find the rows', desc: `A table of ${PAGES * PER_PAGE} rows on ${PAGES} pages, written in no particular order. Find the rows whose value is in a range, three ways, and count the work.` }, `
    <div class="vis-controls">
      <div class="seg small" role="group" aria-label="Query" id="sc-range">${Object.entries(RANGES).map(([k, r]) => `<button type="button" data-range="${k}"><b>${r.label}</b></button>`).join('')}</div>
      <div class="seg small" role="group" aria-label="Scan type" id="sc-kind">${KINDS.map((k) => `<button type="button" data-kind="${k.id}"><b>${k.label}</b></button>`).join('')}</div>
    </div>
    <div class="vis-actions" id="sc-play"></div>
    <div class="sc-index" id="sc-index" aria-hidden="true">Index</div>
    <div class="sc-pages" id="sc-pages" role="img"></div>
    <p class="vis-status" id="sc-note"></p>
    <dl class="vis-stats" id="sc-stats"></dl>
    <div class="table-wrap sc-compare" tabindex="0" role="region" aria-label="All three scans compared"><table class="lb-table" id="sc-table"></table></div>`);

  const compute = () => { const r = RANGES[which]; steps = scanSteps(table, kind, r.lo, r.hi); at = 0; };
  const draw = () => {
    const s = steps[at];
    $$('[data-range]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === which)));
    $$('[data-kind]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
    // which rows have been looked at / matched so far
    const seen = new Set<number>(), hits = new Set<number>(), visited = new Set<number>();
    for (const x of steps.slice(0, at + 1)) { x.examined.forEach((i) => seen.add(i)); x.matched.forEach((i) => hits.add(i)); if (x.page !== undefined) visited.add(x.page); }
    const r = RANGES[which];
    $('#sc-pages', root)!.innerHTML = Array.from({ length: PAGES }, (_, p) => `
      <div class="sc-page${s.page === p ? ' now' : ''}${visited.has(p) ? ' read' : ''}"><span>Page ${p + 1}</span>
        <div>${table.map((row, i) => ({ row, i })).filter(({ row }) => row.page === p).map(({ row, i }) => `<i class="${hits.has(i) ? 'hit' : seen.has(i) ? 'seen' : ''}${row.value >= r.lo && row.value <= r.hi ? ' want' : ''}" title="row ${i + 1}: value ${row.value}">${row.value}</i>`).join('')}</div>
      </div>`).join('');
    $('#sc-pages', root)!.setAttribute('aria-label', `${visited.size} of ${PAGES} pages read so far; ${hits.size} matching rows found.`);
    $('#sc-index', root)!.classList.toggle('on', !!s.indexPhase);
    $('#sc-index', root)!.hidden = kind === 'seq';
    $('#sc-note', root)!.textContent = s.note;
    $('#sc-stats', root)!.innerHTML = [['Page reads', s.pageReads], ['Different pages', s.distinctPages], ['Rows examined', s.rowsExamined], ['Rows returned', s.returned]].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    const all = KINDS.map((k) => ({ k, c: finalCounts(scanSteps(table, k.id, r.lo, r.hi)) }));
    $('#sc-table', root)!.innerHTML = `<thead><tr><th>Scan</th><th>Page reads</th><th>Different pages</th><th>Rows examined</th></tr></thead><tbody>${all.map(({ k, c }) => `<tr class="${k.id === kind ? 'on' : ''}"><td><b>${k.label}</b></td><td>${c.pageReads}</td><td>${c.distinctPages}</td><td>${c.rowsExamined}</td></tr>`).join('')}</tbody>`;
  };
  const pl = player(root, {
    ms: 700,
    step: () => { if (at >= steps.length - 1) return false; at++; draw(); return at < steps.length - 1; },
    reset: () => { at = 0; draw(); },
    describe: () => steps[at].note,
  });
  $('#sc-play', root)!.append(pl.el);
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const rg = t.closest<HTMLElement>('[data-range]')?.dataset.range as keyof typeof RANGES | undefined;
    const kd = t.closest<HTMLElement>('[data-kind]')?.dataset.kind as ScanKind | undefined;
    if (rg) which = rg; else if (kd) kind = kd; else return;
    pl.pause(); compute(); draw();
  });
  compute(); draw();
}

/* ------------------------------------------------------------ composite index */

function compositeIndex(host: HTMLElement) {
  const entries = makeEntries();
  let qid = QUERIES[0].id;
  const root = shell(host, 'v-composite', 'Composite index', { eyebrow: 'Interactive', title: 'An index on (country, status)', desc: 'The entries are sorted by country first and by status within each country, like names in a phone book sorted by surname, then first name. Pick a query and see which entries it can read.' }, `
    <div class="vis-controls"><div class="seg small" role="group" aria-label="Query" id="ci-q">${QUERIES.map((q) => `<button type="button" data-q="${q.id}"><b>${esc(q.label)}</b></button>`).join('')}</div></div>
    <p class="ci-sql" id="ci-sql"></p>
    <div class="ci-index" id="ci-index" role="img"></div>
    <p class="vis-status" id="ci-note" aria-live="polite"></p>
    <dl class="vis-stats" id="ci-stats"></dl>`);
  const draw = () => {
    const q = QUERIES.find((x) => x.id === qid)!;
    const u = usage(entries, q);
    const inRange = (i: number) => u.ranges.some(([a, b]) => i >= a && i < b);
    $$('[data-q]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.q === qid)));
    $('#ci-sql', root)!.innerHTML = `<code>select … from users ${esc(q.sql)}</code>`;
    $('#ci-index', root)!.innerHTML = COUNTRIES.map((c) => `<div class="ci-group"><b>${c}</b><div>${entries.map((e, i) => ({ e, i })).filter(({ e }) => e.country === c).map(({ e, i }) => `<i class="${inRange(i) ? 'hit' : ''} st-${e.status}">${e.status}</i>`).join('')}</div></div>`).join('');
    $('#ci-index', root)!.setAttribute('aria-label', `${u.matched} of ${entries.length} index entries read, in ${u.ranges.length} slice${u.ranges.length === 1 ? '' : 's'}.`);
    $('#ci-note', root)!.textContent = u.note;
    $('#ci-stats', root)!.innerHTML = `<div><dt>Entries read</dt><dd>${u.matched} / ${entries.length}</dd></div><div><dt>Slices</dt><dd>${u.ranges.length}</dd></div><div><dt>Index searches</dt><dd>${u.kind === 'skip' ? `about ${u.searches}` : u.searches}</dd></div>`;
  };
  root.addEventListener('click', (e) => { const q = (e.target as HTMLElement).closest<HTMLElement>('[data-q]')?.dataset.q; if (q) { qid = q; draw(); } });
  draw();
}

/* ------------------------------------------------------------ plan stepper */

export function mountPlanTree(host: HTMLElement, plan: PlanNode, opts: { title?: string } = {}) {
  const steps = planSteps(plan);
  const hot = hottest(steps);
  let at = -1;
  const root = shell(host, 'v-plan', 'Query plan', { eyebrow: 'Plan stepper', title: opts.title ?? 'Run the plan one node at a time', desc: 'A plan runs from the inside out: the most indented nodes produce rows first and pass them up. Step through it in that order.' }, `
    <div class="vis-actions" id="pt-play"></div>
    <div class="pt-body">
      <ol class="pt-tree" id="pt-tree"></ol>
      <div class="pt-panel" id="pt-panel" aria-live="off"></div>
    </div>`);
  const byPath = new Map(steps.map((s) => [s.path.join('.'), s]));
  const treeHtml = (n: PlanNode, path: number[]): string => {
    const s = byPath.get(path.join('.'))!;
    const kids = n.Plans ?? [];
    return `<li><button type="button" class="pt-node${s.flags.length ? ' flag' : ''}" data-step="${s.index}">
      <b>${esc(s.label)}</b>
      <span>est ${fmt(s.estRows)} · actual ${fmt(s.actualRows, 2)}${s.loops > 1 ? ` × ${fmt(s.loops)} loops` : ''} · ${fmt(s.selfMs, 2)} ms here</span>
    </button>${kids.length ? `<ol>${kids.map((c, i) => treeHtml(c, [...path, i])).join('')}</ol>` : ''}</li>`;
  };
  $('#pt-tree', root)!.innerHTML = treeHtml(plan, [0]);
  const panel = (s: PlanStep | null) => {
    if (!s) return `<p>${steps.length} node${steps.length === 1 ? '' : 's'}. Most of the time went to <b>${esc(hot.label)}</b> (${fmt(hot.selfMs, 2)} ms of its own). Press Step, or pick a node.</p>`;
    const n = s.node;
    const buf = (Number(n['Shared Hit Blocks'] ?? 0) + Number(n['Shared Read Blocks'] ?? 0));
    return `<p class="pt-step">Step ${s.index + 1} of ${steps.length}</p>
      <h4>${esc(s.label)}</h4>
      <p>${esc(NODE_HELP[nodeName(n)] ?? NODE_HELP[n['Node Type']] ?? 'A step of the plan.')}</p>
      <dl class="pt-figs">
        <div><dt>Rows expected</dt><dd>${fmt(s.estRows)}</dd></div>
        <div><dt>Rows produced</dt><dd>${fmt(s.actualRows, 2)}${s.loops > 1 ? ` × ${fmt(s.loops)}` : ''}</dd></div>
        <div><dt>Time in this node</dt><dd>${fmt(s.selfMs, 2)} ms</dd></div>
        <div><dt>Pages (incl. children)</dt><dd>${fmt(buf)}</dd></div>
      </dl>
      ${s.flags.length ? `<ul class="pt-flags">${s.flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '<p class="pt-ok">Nothing alarming here.</p>'}`;
  };
  const draw = () => {
    $$('.pt-node', root).forEach((b) => { const on = Number(b.dataset.step) === at; b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'step' : 'false'); b.classList.toggle('done', Number(b.dataset.step) < at); });
    $('#pt-panel', root)!.innerHTML = panel(at >= 0 ? steps[at] : null);
  };
  const pl = player(root, {
    ms: 1600,
    step: () => { if (at >= steps.length - 1) return false; at++; draw(); return at < steps.length - 1; },
    reset: () => { at = -1; draw(); },
    describe: () => (at >= 0 ? `${steps[at].label}: expected ${fmt(steps[at].estRows)} rows, produced ${fmt(steps[at].actualRows, 2)}. ${steps[at].flags.join(' ')}` : 'Back to the start.'),
  });
  $('#pt-play', root)!.append(pl.el);
  root.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-step]'); if (b) { pl.pause(); at = Number(b.dataset.step); draw(); } });
  draw();
}

function planTree(host: HTMLElement) {
  const json = host.querySelector('script[type="application/json"]')?.textContent;
  if (!json) return;
  const fallback = host.querySelector('pre');
  const mount = document.createElement('div');
  host.prepend(mount);
  mountPlanTree(mount, JSON.parse(json) as PlanNode, { title: host.dataset.title });
  if (fallback) { const d = document.createElement('details'); d.className = 'widget-original'; d.innerHTML = '<summary>The same plan as text</summary>'; d.append(fallback); host.append(d); }
}

/* ------------------------------------------------------------ join algorithms */

function joinAlgos(host: HTMLElement) {
  const ALGOS: { id: JoinAlgo; label: string }[] = [
    { id: 'nested', label: 'Nested loop' }, { id: 'nested-index', label: 'Nested loop + index' }, { id: 'hash', label: 'Hash join' }, { id: 'merge', label: 'Merge join' },
  ];
  let algo: JoinAlgo = 'nested';
  let steps: JoinStep[] = joinSteps(algo);
  let at = 0;
  const root = shell(host, 'v-joins', 'Join algorithms', { eyebrow: 'Animation', title: 'Three ways to join two tables', desc: `Join ${OUTER.length} orders to ${INNER.length} users on orders.user_id = users.id. Each algorithm finds the same pairs; count the work it takes.` }, `
    <div class="vis-controls"><div class="seg small" role="group" aria-label="Algorithm" id="j-algo">${ALGOS.map((a) => `<button type="button" data-j="${a.id}"><b>${a.label}</b></button>`).join('')}</div></div>
    <div class="vis-actions" id="j-play"></div>
    <div class="j-stage">
      <div class="j-col"><b>orders (outer)</b><ol id="j-outer"></ol></div>
      <div class="j-col"><b>users (inner)</b><ol id="j-inner"></ol></div>
      <div class="j-col j-buckets" id="j-buckets" hidden><b>hash table</b><div id="j-bk"></div></div>
    </div>
    <p class="vis-status" id="j-note"></p>
    <dl class="vis-stats" id="j-stats"></dl>`);
  const draw = () => {
    const s = steps[at];
    $$('[data-j]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.j === algo)));
    const oOrd = s.outerOrder ?? OUTER.map((_, i) => i);
    const iOrd = s.innerOrder ?? INNER.map((_, j) => j);
    const outDone = new Set(s.matched.map(([i]) => i)), inDone = new Set(s.matched.map(([, j]) => j));
    const cmp = new Set(s.inner ?? []);
    $('#j-outer', root)!.innerHTML = oOrd.map((i) => `<li class="${s.outer === i ? 'now' : ''}${outDone.has(i) ? ' hit' : ''}"><span>${OUTER[i].label}</span><code>user ${OUTER[i].key}</code></li>`).join('');
    $('#j-inner', root)!.innerHTML = iOrd.map((j) => `<li class="${cmp.has(j) ? 'now' : ''}${inDone.has(j) ? ' hit' : ''}"><span>${INNER[j].label}</span><code>id ${INNER[j].key}</code></li>`).join('');
    const bk = s.buckets;
    $('#j-buckets', root)!.hidden = !bk;
    if (bk) $('#j-bk', root)!.innerHTML = bk.map((b, n) => `<div class="j-bucket${s.bucket === n ? ' now' : ''}"><span>bucket ${n}</span>${b.map((j) => `<i>${INNER[j].key}</i>`).join('') || '<em>empty</em>'}</div>`).join('');
    $('#j-note', root)!.textContent = s.note;
    $('#j-stats', root)!.innerHTML = [['Comparisons', s.comparisons], ['Inner rows read', s.innerReads], ['Rows held in memory', s.memory], ['Pairs found', s.matched.length]].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  };
  const pl = player(root, {
    ms: 900,
    step: () => { if (at >= steps.length - 1) return false; at++; draw(); return at < steps.length - 1; },
    reset: () => { at = 0; draw(); },
    describe: () => steps[at].note,
  });
  $('#j-play', root)!.append(pl.el);
  root.addEventListener('click', (e) => {
    const j = (e.target as HTMLElement).closest<HTMLElement>('[data-j]')?.dataset.j as JoinAlgo | undefined;
    if (!j) return;
    pl.pause(); algo = j; steps = joinSteps(algo); at = 0; draw();
  });
  draw();
}

/* ------------------------------------------------------------ recorded concurrency traces */

function txTrace(host: HTMLElement) {
  const id = host.dataset.id!;
  const src = host.dataset.src ?? `${document.documentElement.dataset.base ?? '/'}data/db/traces/${id}.json`;
  fetch(src).then((r) => r.json()).then((t: Trace) => mountTrace(host, t)).catch(() => { /* the static version stays */ });
}

function mountTrace(host: HTMLElement, t: Trace) {
  let count = 1;
  const root = shell(host, 'v-trace', `Recorded: ${t.title}`, { eyebrow: 'Recorded on a real server', title: t.title, desc: `${t.sessions.length} sessions, each its own connection to ${t.engine.replace(/ \(.*\)$/, '')}, recorded on ${t.recorded}. Step through what each session ran and what the server did.` }, `
    <div class="vis-actions" id="tx-play"></div>
    <div class="tx-head" style="--n:${t.sessions.length}">${t.sessions.map((s) => `<div class="tx-sess" data-s="${s}"><b>Session ${s}</b><span class="tx-state"></span></div>`).join('')}</div>
    <ol class="tx-log" style="--n:${t.sessions.length}" aria-label="Statements in order"></ol>
    <div class="tx-locks" tabindex="0" role="region" aria-label="Locks at this moment"></div>
    <p class="vis-status tx-note"></p>`);
  const col = (s: string) => t.sessions.indexOf(s) + 1;
  const result = (e: TraceEvent) => {
    if (e.status === 'waiting') return '<span class="tx-r wait">waiting…</span>';
    if (e.status === 'error') return `<span class="tx-r err">ERROR ${esc(e.code ?? '')}: ${esc(e.error ?? '')}</span>`;
    if (e.rows?.length) return `<span class="tx-r ok">${esc(e.rows.map((r) => Object.values(r).join(', ')).join(' | '))}</span>`;
    return `<span class="tx-r ok">${esc(e.command ?? 'OK')}${e.rowCount ? ` ${e.rowCount}` : ''}</span>`;
  };
  const draw = () => {
    const views = sessionsAt(t, count);
    $$('.tx-sess', root).forEach((el) => { const v = views[el.dataset.s!]; el.querySelector('.tx-state')!.textContent = v.state + (v.waitingFor.length ? ` for ${v.waitingFor.join(', ')}` : ''); el.dataset.state = v.state.replace(' ', '-'); });
    $('.tx-log', root)!.innerHTML = t.events.slice(0, count).map((e, i) => `
      <li class="${i === count - 1 ? 'now' : ''}${e.kind === 'resumed' ? ' resumed' : ''}" style="grid-column:${col(e.session)};grid-row:${i + 1}">
        <span class="tx-who">${e.session}${e.kind === 'resumed' ? ' · finishes' : ''}</span>
        <code>${esc(e.sql)}</code>${result(e)}
      </li>`).join('');
    const locks = locksAt(t, count).filter((l) => l.type !== 'relation' || !l.granted || l.mode !== 'AccessShareLock' || t.id === 'lock-queue');
    $('.tx-locks', root)!.innerHTML = locks.length
      ? `<table class="lb-table"><thead><tr><th>Session</th><th>Lock</th><th>On</th><th>State</th></tr></thead><tbody>${locks.map((l) => `<tr class="${l.granted ? '' : 'on'}"><td>${l.session}</td><td>${esc(l.mode)}</td><td>${esc(l.on)}</td><td>${l.granted ? 'held' : `waiting for ${l.blockedBy.join(', ') || '?'}`}</td></tr>`).join('')}</tbody></table>`
      : '<p class="ch-note">No locks worth showing at this moment.</p>';
    const e = t.events[count - 1];
    $('.tx-note', root)!.textContent = e.kind === 'resumed'
      ? `Session ${e.session} stops waiting: ${e.status === 'error' ? `its statement failed (${e.error}).` : 'its statement completes.'}`
      : (e.note || (e.status === 'waiting' ? `Session ${e.session} has to wait.` : ''));
  };
  const pl = player(root, {
    ms: 1500,
    step: () => { if (count >= t.events.length) return false; count++; draw(); return count < t.events.length; },
    reset: () => { count = 1; draw(); },
    describe: () => { const e = t.events[count - 1]; return `Session ${e.session}: ${e.sql}. ${e.status === 'waiting' ? 'Waiting.' : e.status === 'error' ? `Error: ${e.error}` : 'Done.'} ${e.note ?? ''}`; },
  });
  $('#tx-play', root)!.append(pl.el);
  draw();
}

export const dbVisualWidgets: Record<string, (host: HTMLElement) => void> = {
  btree,
  'scan-compare': scanCompare,
  'composite-index': compositeIndex,
  'plan-tree': planTree,
  'join-algos': joinAlgos,
  'tx-trace': txTrace,
};
