// Interactive labs. Every simulation here is deterministic (seeded) so a given setting
// always produces the same picture, and nothing leaves the browser.

const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => [...r.querySelectorAll<T>(s)];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

import { mulberry32, hash32, simulateCache, simulateLb, summarizeLb, DETECT_TICKS } from '../lib/sim';
import type { Policy, Step, Algo, LbResult, LbSummary, LbOptions } from '../lib/sim';
import { player } from './lab-kit';
import { createCap, capWrite, capRead, capSetPartition, type CapState, type CapEvent } from '../lib/cap';

/* ------------------------------------------------------------ shared helpers */

const num = (n: number, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d });
function human(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e12) return `${+(n / 1e12).toPrecision(3)} T`;
  if (a >= 1e9) return `${+(n / 1e9).toPrecision(3)} B`;
  if (a >= 1e6) return `${+(n / 1e6).toPrecision(3)} M`;
  if (a >= 1e4) return `${+(n / 1e3).toPrecision(3)} K`;
  if (a >= 100) return num(n);
  return `${+n.toPrecision(3)}`;
}
function bytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
  let i = 0;
  while (Math.abs(n) >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${+n.toPrecision(3)} ${units[i]}`;
}

function shell(host: HTMLElement, cls: string, label: string, head: { eyebrow: string; title: string; desc: string }, body: string, actions = ''): HTMLElement {
  const root = document.createElement('section');
  root.className = `widget lab ${cls}`;
  root.setAttribute('aria-label', label);
  root.innerHTML = `<div class="widget-head"><div><p class="eyebrow">${head.eyebrow}</p><h3>${head.title}</h3><p>${head.desc}</p></div>${actions ? `<div class="head-actions">${actions}</div>` : ''}</div>${body}`;
  host.replaceChildren(root);
  return root;
}

/* ------------------------------------------------------------ capacity estimator */

interface EstInputs { dau: number; reads: number; writes: number; rkb: number; wkb: number; peak: number; years: number; repl: number; hot: number; perServer: number }

function estimator(host: HTMLElement) {
  const fields: { id: keyof EstInputs; label: string; unit: string; help: string; step?: number }[] = [
    { id: 'dau', label: 'Daily active users', unit: 'users', help: 'People who use the system on a typical day' },
    { id: 'reads', label: 'Reads per user per day', unit: 'reads', help: 'Page views, timeline loads, lookups' },
    { id: 'writes', label: 'Writes per user per day', unit: 'writes', help: 'Posts, uploads, updates', step: 0.1 },
    { id: 'rkb', label: 'Size of a read response', unit: 'KB', help: 'Average payload sent back', step: 0.1 },
    { id: 'wkb', label: 'Size of a write', unit: 'KB', help: 'Average payload stored', step: 0.1 },
    { id: 'peak', label: 'Peak factor', unit: '× average', help: 'Busiest second versus the daily average', step: 0.5 },
    { id: 'years', label: 'Retention', unit: 'years', help: 'How long you keep the data', step: 0.5 },
    { id: 'repl', label: 'Replication factor', unit: 'copies', help: 'Copies kept for durability' },
    { id: 'hot', label: 'Hot data to cache', unit: '% of daily reads', help: 'Share of a day\'s read data worth holding in memory' },
    { id: 'perServer', label: 'Capacity of one app server', unit: 'req/s', help: 'What a single server comfortably handles' },
  ];
  const presets: Record<string, { label: string; v: EstInputs }> = {
    pastebin: { label: 'Pastebin', v: { dau: 333_333, reads: 10, writes: 1, rkb: 1, wkb: 1, peak: 3, years: 3, repl: 3, hot: 20, perServer: 1000 } },
    shortener: { label: 'URL shortener', v: { dau: 2_000_000, reads: 50, writes: 1, rkb: 0.5, wkb: 0.5, peak: 3, years: 5, repl: 3, hot: 20, perServer: 2000 } },
    twitter: { label: 'Twitter-like', v: { dau: 100_000_000, reads: 100, writes: 5, rkb: 2, wkb: 10, peak: 3, years: 3, repl: 3, hot: 10, perServer: 2000 } },
    chat: { label: 'Chat app', v: { dau: 50_000_000, reads: 60, writes: 40, rkb: 0.2, wkb: 0.2, peak: 4, years: 2, repl: 3, hot: 5, perServer: 5000 } },
    photos: { label: 'Photo sharing', v: { dau: 20_000_000, reads: 80, writes: 0.5, rkb: 300, wkb: 2000, peak: 3, years: 5, repl: 3, hot: 5, perServer: 1000 } },
  };

  const root = shell(host, 'estimator', 'Capacity estimator', { eyebrow: 'Calculator', title: 'Size a system on the back of an envelope', desc: 'Pick a starting point, then change any assumption. Results update as you type.' }, `
    <div class="est-presets" role="group" aria-label="Presets">${Object.entries(presets).map(([k, p]) => `<button type="button" class="chip-btn" data-preset="${k}">${p.label}</button>`).join('')}</div>
    <div class="est-grid">
      <div class="est-inputs">${fields.map((f) => `
        <label class="lab-field"><span>${f.label}<small>${f.help}</small></span>
        <div class="lab-input"><input type="number" inputmode="decimal" min="0" step="${f.step ?? 1}" data-f="${f.id}" /><em>${f.unit}</em></div></label>`).join('')}
      </div>
      <div class="est-out" aria-live="polite"></div>
    </div>`);

  const inputs = Object.fromEntries($$<HTMLInputElement>('input[data-f]', root).map((i) => [i.dataset.f!, i])) as Record<keyof EstInputs, HTMLInputElement>;
  const out = $('.est-out', root)!;

  const read = (): EstInputs => Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, Math.max(0, parseFloat(el.value) || 0)])) as unknown as EstInputs;

  const calc = () => {
    const v = read();
    const S = 86400;
    const wps = (v.dau * v.writes) / S;
    const rps = (v.dau * v.reads) / S;
    const pw = wps * v.peak;
    const pr = rps * v.peak;
    const dayBytes = v.dau * v.writes * v.wkb * 1024;
    const yearBytes = dayBytes * 365;
    const total = yearBytes * v.years * v.repl;
    const ingress = pw * v.wkb * 1024;
    const egress = pr * v.rkb * 1024;
    const cache = v.dau * v.reads * v.rkb * 1024 * (v.hot / 100);
    const servers = v.perServer ? Math.max(1, Math.ceil((pr + pw) / v.perServer)) : 0;
    const ratio = wps > 0 ? rps / wps : Infinity;

    const card = (label: string, value: string, how: string, tone = '') => `<div class="est-card ${tone}"><span class="est-label">${label}</span><b>${value}</b><small>${how}</small></div>`;
    const hints: string[] = [];
    if (pw > 1000) hints.push('Peak writes are beyond what one relational primary comfortably takes. Plan on sharding or a write-optimised store.');
    if (ratio >= 10 && isFinite(ratio)) hints.push('Heavily read-biased. A cache and read replicas will pay off before anything else.');
    if (total > 10 * 1024 ** 4) hints.push('The retained data will not fit on one machine, so storage has to be distributed.');
    if (egress > 1024 ** 3) hints.push('Outbound traffic is above 1 GB/s. Serve static and cacheable content from a CDN.');
    if (!hints.length) hints.push('Modest numbers: a single well-tuned database and a few app servers go a long way. Resist over-engineering.');

    out.innerHTML = `
      <div class="est-cards">
        ${card('Write rate', `${human(wps)}/s`, `${human(v.dau * v.writes)} writes/day ÷ 86,400`)}
        ${card('Peak writes', `${human(pw)}/s`, `average × ${v.peak}`, pw > 1000 ? 'warn' : '')}
        ${card('Read rate', `${human(rps)}/s`, `${human(v.dau * v.reads)} reads/day ÷ 86,400`)}
        ${card('Peak reads', `${human(pr)}/s`, `average × ${v.peak}`)}
        ${card('Read : write', isFinite(ratio) ? `${human(ratio)} : 1` : 'no writes', 'reads ÷ writes')}
        ${card('New data per day', bytes(dayBytes), `writes/day × ${v.wkb} KB`)}
        ${card('Storage per year', bytes(yearBytes), 'per day × 365')}
        ${card(`Storage, ${v.years} yr × ${v.repl} copies`, bytes(total), 'per year × years × replicas', 'strong')}
        ${card('Ingress, peak', `${bytes(ingress)}/s`, 'peak writes × write size')}
        ${card('Egress, peak', `${bytes(egress)}/s`, 'peak reads × read size')}
        ${card('Cache to hold hot data', bytes(cache), `${v.hot}% of a day's read data`)}
        ${card('App servers (peak)', human(servers), `(peak reads + writes) ÷ ${human(v.perServer)} req/s`, 'strong')}
      </div>
      <div class="est-hints"><h4>What this suggests</h4><ul>${hints.map((h) => `<li>${h}</li>`).join('')}</ul><p class="est-note">Rules of thumb, not a verdict. State your assumptions out loud and let the interviewer adjust them.</p></div>`;
  };

  const apply = (p: EstInputs) => { for (const k of Object.keys(p) as (keyof EstInputs)[]) inputs[k].value = String(p[k]); calc(); };
  root.addEventListener('input', (e) => { if ((e.target as HTMLElement).matches('input[data-f]')) { $$('[data-preset]', root).forEach((b) => b.setAttribute('aria-pressed', 'false')); calc(); } });
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-preset]');
    if (!b) return;
    apply(presets[b.dataset.preset!].v);
    $$('[data-preset]', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });
  apply(presets.pastebin.v);
  $('[data-preset="pastebin"]', root)?.setAttribute('aria-pressed', 'true');
}

/* ------------------------------------------------------------ consistent hashing */

function consistentHash(host: HTMLElement) {
  const NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const COLORS = ['#0c7a73', '#4f5bd5', '#c4690a', '#cc3a5d', '#8a4fd0', '#0b84b8', '#9a7b0a', '#5f8a2a'];
  const color = (n: string) => COLORS[NAMES.indexOf(n) % COLORS.length];
  const KEYS = 5000;
  const keyHashes = Array.from({ length: KEYS }, (_, i) => hash32(`key-${i}`));
  const SAMPLE = Array.from({ length: 56 }, (_, i) => hash32(`sample-${i}`));
  const TAU = Math.PI * 2;

  let nodes = ['A', 'B', 'C'];
  let vnodes = 1;
  let prevOwners: string[] | null = null;
  let moved: { label: string; ch: number; mod: number } | null = null;
  let lookup = 'user:42';

  const root = shell(host, 'chash', 'Consistent hashing', { eyebrow: 'Simulation', title: 'The hash ring', desc: 'Nodes and keys are hashed onto the same circle. A key belongs to the next node clockwise.' }, `
    <div class="ch-controls">
      <div class="ch-nodes" id="ch-nodes"></div>
      <label class="lab-range"><span>Virtual nodes per server <b id="ch-v">1</b></span><input type="range" min="1" max="100" value="1" id="ch-vs" aria-label="Virtual nodes per server" /></label>
    </div>
    <div class="ch-body">
      <div class="ch-ring"><svg viewBox="0 0 360 360" role="img" aria-label="Hash ring showing which node owns each arc"></svg></div>
      <div class="ch-side">
        <div class="ch-moved" id="ch-moved" aria-live="polite"></div>
        <h4>Share of ${num(KEYS)} keys</h4>
        <div class="ch-bars" id="ch-bars"></div>
        <label class="lab-field inline"><span>Look up a key</span><div class="lab-input"><input type="text" id="ch-key" value="user:42" spellcheck="false" autocomplete="off" /></div></label>
        <p class="ch-lookup" id="ch-lookup"></p>
      </div>
    </div>`, '<button type="button" class="chip-btn" id="ch-reset">Reset</button>');

  const ringOf = () => {
    const r: { pos: number; node: string }[] = [];
    for (const n of nodes) for (let i = 0; i < vnodes; i++) r.push({ pos: hash32(`${n}#${i}`), node: n });
    return r.sort((a, b) => a.pos - b.pos);
  };
  const ownerIn = (ring: { pos: number; node: string }[], h: number) => {
    let lo = 0, hi = ring.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ring[mid].pos >= h) hi = mid; else lo = mid + 1; }
    return ring[lo === ring.length ? 0 : lo];
  };
  const pt = (pos: number, r: number) => { const a = (pos / 4294967296) * TAU - Math.PI / 2; return [180 + r * Math.cos(a), 180 + r * Math.sin(a)]; };

  const draw = (change?: { label: string; oldN: number; newN: number }) => {
    const ring = ringOf();
    const owners = keyHashes.map((h) => ownerIn(ring, h).node);
    if (prevOwners && change) {
      const ch = owners.reduce((n, o, i) => n + (o !== prevOwners![i] ? 1 : 0), 0) / KEYS;
      const mod = keyHashes.reduce((n, h) => n + (h % change.oldN !== h % change.newN ? 1 : 0), 0) / KEYS;
      moved = { label: change.label, ch, mod };
    }
    prevOwners = owners;

    // arcs: the stretch ending at each virtual node belongs to that node
    const R = 128;
    let svg = `<circle cx="180" cy="180" r="${R}" fill="none" stroke="var(--line)" stroke-width="14"/>`;
    ring.forEach((v, i) => {
      const prev = ring[(i - 1 + ring.length) % ring.length].pos;
      const a0 = (prev / 4294967296) * TAU - Math.PI / 2;
      let a1 = (v.pos / 4294967296) * TAU - Math.PI / 2;
      if (ring.length === 1) { svg += `<circle cx="180" cy="180" r="${R}" fill="none" stroke="${color(v.node)}" stroke-width="14" opacity=".85"/>`; return; }
      if (a1 < a0) a1 += TAU;
      const [x0, y0] = [180 + R * Math.cos(a0), 180 + R * Math.sin(a0)];
      const [x1, y1] = [180 + R * Math.cos(a1), 180 + R * Math.sin(a1)];
      svg += `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" fill="none" stroke="${color(v.node)}" stroke-width="14" opacity=".85"/>`;
    });
    if (ring.length <= 60) for (const v of ring) { const [x, y] = pt(v.pos, R); svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5" fill="var(--surface)" stroke="${color(v.node)}" stroke-width="2.5"/>`; }
    for (const h of SAMPLE) { const [x, y] = pt(h, R - 20); svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="${color(ownerIn(ring, h).node)}"/>`; }
    const lh = hash32(lookup);
    const lo = ownerIn(ring, lh);
    const [kx, ky] = pt(lh, R - 20);
    const [nx, ny] = pt(lo.pos, R);
    svg += `<line x1="${kx.toFixed(1)}" y1="${ky.toFixed(1)}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="var(--ink)" stroke-width="1.4" stroke-dasharray="3 3"/><circle cx="${kx.toFixed(1)}" cy="${ky.toFixed(1)}" r="5" fill="var(--ink)"/>`;
    svg += `<text x="180" y="176" text-anchor="middle" class="ch-c1">${nodes.length} server${nodes.length > 1 ? 's' : ''}</text><text x="180" y="196" text-anchor="middle" class="ch-c2">${ring.length} point${ring.length > 1 ? 's' : ''} on the ring</text>`;
    $('svg', root)!.innerHTML = svg;

    // nodes
    $('#ch-nodes', root)!.innerHTML = nodes.map((n) => `<span class="ch-chip" style="--c:${color(n)}"><i></i>${n}<button type="button" data-rm="${n}" aria-label="Remove server ${n}" ${nodes.length <= 1 ? 'disabled' : ''}>×</button></span>`).join('')
      + `<button type="button" class="chip-btn" id="ch-add" ${nodes.length >= NAMES.length ? 'disabled' : ''}>+ Add server</button>`;

    // bars
    const counts = Object.fromEntries(nodes.map((n) => [n, 0]));
    for (const o of owners) counts[o]++;
    const ideal = KEYS / nodes.length;
    $('#ch-bars', root)!.innerHTML = nodes.map((n) => {
      const pct = (counts[n] / KEYS) * 100;
      return `<div class="ch-bar"><span>${n}</span><div><i style="width:${Math.min(100, pct * (nodes.length > 1 ? 1.6 : 1))}%;background:${color(n)}"></i><u style="left:${Math.min(100, (100 / nodes.length) * (nodes.length > 1 ? 1.6 : 1))}%"></u></div><b>${pct.toFixed(1)}%</b></div>`;
    }).join('') + `<p class="ch-note">Dashed line = perfectly even (${(100 / nodes.length).toFixed(1)}%). Busiest server holds ${(Math.max(...Object.values(counts)) / ideal).toFixed(2)}× its fair share.</p>`;

    $('#ch-moved', root)!.innerHTML = moved
      ? `<h4>${esc(moved.label)}</h4><div class="ch-compare"><div><b>${(moved.ch * 100).toFixed(1)}%</b><span>keys moved with consistent hashing</span></div><div class="bad"><b>${(moved.mod * 100).toFixed(1)}%</b><span>would move with <code>hash mod N</code></span></div></div>`
      : '<h4>Change something</h4><p class="ch-note">Add or remove a server and compare how many keys have to move.</p>';
    $('#ch-lookup', root)!.innerHTML = `<code>${esc(lookup)}</code> hashes to <b>${((lh / 4294967296) * 360).toFixed(0)}°</b>, so the next point clockwise belongs to <b class="ch-node" style="--c:${color(lo.node)}">server ${lo.node}</b>.`;
    $('#ch-v', root)!.textContent = String(vnodes);
  };

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('#ch-add') && nodes.length < NAMES.length) {
      const next = NAMES.find((n) => !nodes.includes(n))!;
      const oldN = nodes.length;
      nodes = [...nodes, next].sort();
      draw({ label: `Added server ${next}`, oldN, newN: oldN + 1 });
    } else if (t.closest('[data-rm]') && nodes.length > 1) {
      const n = t.closest<HTMLElement>('[data-rm]')!.dataset.rm!;
      const oldN = nodes.length;
      nodes = nodes.filter((x) => x !== n);
      draw({ label: `Removed server ${n}`, oldN, newN: oldN - 1 });
    } else if (t.closest('#ch-reset')) {
      nodes = ['A', 'B', 'C']; vnodes = 1; prevOwners = null; moved = null; ($('#ch-vs', root) as HTMLInputElement).value = '1'; draw();
    }
  });
  $('#ch-vs', root)!.addEventListener('input', (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    if (v === vnodes) return;
    vnodes = v;
    draw({ label: `Changed to ${v} virtual node${v > 1 ? 's' : ''} per server`, oldN: nodes.length, newN: nodes.length });
    moved = moved && { ...moved, mod: 0 };
    $('#ch-moved', root)!.innerHTML = `<h4>Changed to ${v} virtual node${v > 1 ? 's' : ''} per server</h4><p class="ch-note">Watch the bars: more points on the ring means arcs of more even length.</p>`;
  });
  $('#ch-key', root)!.addEventListener('input', (e) => { lookup = (e.target as HTMLInputElement).value; const ring = ringOf(); void ring; draw(); });
  draw();
}

/* ------------------------------------------------------------ cache eviction */

function cacheEviction(host: HTMLElement) {
  const LEN = 120; // requests per pattern: long enough that one lucky stretch does not decide the result
  // Zipf-like popularity over n keys (the k-th most popular key is requested about 1/k as often), the usual shape of real traffic.
  const zipf = (n: number, seed: number) => {
    const r = mulberry32(seed), w = Array.from({ length: n }, (_, k) => 1 / (k + 1)), total = w.reduce((a, b) => a + b, 0);
    return Array.from({ length: LEN }, () => { let x = r() * total, i = 0; while (i < n - 1 && x > w[i]) { x -= w[i]; i++; } return String.fromCharCode(65 + i); });
  };
  const policies: { id: Policy; label: string; short: string }[] = [
    { id: 'lru', label: 'LRU', short: 'least recently used' },
    { id: 'lfu', label: 'LFU', short: 'least frequently used' },
    { id: 'fifo', label: 'FIFO', short: 'first in, first out' },
    { id: 'random', label: 'Random', short: 'random victim' },
    { id: 'opt', label: 'Optimal', short: 'knows the future' },
  ];
  const patterns: Record<string, { label: string; make: (cap: number) => string[] }> = {
    hot: { label: 'Hot keys', make: () => zipf(16, 11) },
    scan: {
      label: 'Hot keys + scans', make: () => {
        const r = mulberry32(5), out: string[] = []; let s = 0;
        while (out.length < LEN) {
          for (let i = 0; i < 12 && out.length < LEN; i++) out.push('ABCD'[Math.floor(r() * 4)]);
          for (let i = 0; i < 8 && out.length < LEN; i++) out.push(`s${++s}`);
        }
        return out;
      },
    },
    loop: { label: 'Loop', make: (cap) => Array.from({ length: LEN }, (_, i) => String.fromCharCode(65 + (i % (cap + 1)))) },
    uniform: { label: 'Uniform random', make: () => { const r = mulberry32(3); return Array.from({ length: LEN }, () => String.fromCharCode(65 + Math.floor(r() * 12))); } },
    custom: { label: 'Custom', make: () => [] },
  };

  let pattern = 'scan';
  let cap = 4;
  let policy: Policy = 'lru';
  let step = 0;
  let custom = 'A B C A B D A B C D E A B';
  let timer: number | undefined;

  const root = shell(host, 'cevict', 'Cache eviction simulator', { eyebrow: 'Simulation', title: 'Which entry gets thrown out?', desc: 'The same request sequence is replayed through every policy. Step through one to see the cache change.' }, `
    <div class="ce-controls">
      <div class="seg small" id="ce-pattern" role="group" aria-label="Traffic pattern">${Object.entries(patterns).map(([k, p]) => `<button type="button" data-p="${k}"><b>${p.label}</b></button>`).join('')}</div>
      <label class="lab-range"><span>Cache size <b id="ce-cap">4</b> entries</span><input type="range" id="ce-cs" min="2" max="8" value="4" aria-label="Cache size" /></label>
    </div>
    <div class="ce-custom" id="ce-custom" hidden><label class="lab-field inline"><span>Requests (space separated)</span><div class="lab-input"><input type="text" id="ce-ci" spellcheck="false" autocomplete="off" /></div></label></div>
    <div class="ce-results" id="ce-results"></div>
    <div class="ce-detail">
      <div class="ce-detail-head"><b id="ce-title"></b><div class="ce-play"><button type="button" class="chip-btn" id="ce-prev" aria-label="Previous request">‹</button><button type="button" class="chip-btn" id="ce-play">Play</button><button type="button" class="chip-btn" id="ce-next" aria-label="Next request">›</button></div></div>
      <div class="ce-seq" id="ce-seq" role="list"></div>
      <div class="ce-now" id="ce-now" aria-live="polite"></div>
    </div>`);

  const seqOf = () => pattern === 'custom' ? custom.split(/[\s,]+/).filter(Boolean).slice(0, 80) : patterns[pattern].make(cap);

  const draw = () => {
    const seq = seqOf();
    $$('#ce-pattern button', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.p === pattern)));
    ($('#ce-custom', root) as HTMLElement).hidden = pattern !== 'custom';
    $('#ce-cap', root)!.textContent = String(cap);
    if (!seq.length) { $('#ce-results', root)!.innerHTML = '<p class="ch-note">Type a few keys such as <code>A B C A B D</code>.</p>'; $('#ce-seq', root)!.innerHTML = ''; $('#ce-now', root)!.innerHTML = ''; return; }
    const all = Object.fromEntries(policies.map((p) => [p.id, simulateCache(p.id, seq, cap)])) as Record<Policy, Step[]>;
    const rate = (p: Policy) => all[p].filter((s) => s.hit).length / seq.length;
    const best = Math.max(...policies.filter((p) => p.id !== 'opt').map((p) => rate(p.id)));
    $('#ce-results', root)!.innerHTML = policies.map((p) => `
      <button type="button" class="ce-row${p.id === policy ? ' on' : ''}" data-pol="${p.id}" aria-pressed="${p.id === policy}">
        <span class="ce-name"><b>${p.label}</b><small>${p.short}</small></span>
        <span class="ce-track"><i class="${p.id === 'opt' ? 'opt' : rate(p.id) === best ? 'best' : ''}" style="width:${(rate(p.id) * 100).toFixed(1)}%"></i></span>
        <span class="ce-pct">${(rate(p.id) * 100).toFixed(0)}%</span>
      </button>`).join('');
    const steps = all[policy];
    step = Math.min(step, steps.length);
    $('#ce-title', root)!.textContent = `${policies.find((p) => p.id === policy)!.label}, request ${step} of ${steps.length}`;
    $('#ce-seq', root)!.innerHTML = steps.map((s, i) => i >= step
      ? `<span role="listitem" class="ce-chip future">${esc(s.key)}</span>`  // outcomes stay hidden until you reach them
      : `<span role="listitem" class="ce-chip ${s.hit ? 'hit' : 'miss'}${i === step - 1 ? ' cur' : ''}" title="${s.hit ? 'hit' : 'miss'}">${esc(s.key)}<span class="sr-only"> ${s.hit ? 'hit' : 'miss'}</span></span>`).join('');
    const cur = step > 0 ? steps[step - 1] : undefined;
    const slots = Array.from({ length: cap }, (_, i) => cur?.cache[i]);
    $('#ce-now', root)!.innerHTML = `<div class="ce-slots">${slots.map((k) => `<span class="ce-slot${k ? '' : ' empty'}${cur && k === cur.key ? ' fresh' : ''}">${k ? esc(k) : ''}</span>`).join('')}</div>`
      + `<p class="ch-note">${cur ? (cur.hit ? `<b class="ok">Hit</b> on ${esc(cur.key)}.` : `<b class="bad">Miss</b> on ${esc(cur.key)}${cur.evicted ? `, so <b>${esc(cur.evicted)}</b> was evicted to make room.` : ', and there was still free space.'}`) : 'Press play or step forward to watch the cache fill.'}</p>`;
  };

  const stop = () => { if (timer) { clearInterval(timer); timer = undefined; $('#ce-play', root)!.textContent = 'Play'; } };
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const p = t.closest<HTMLElement>('[data-p]');
    const pol = t.closest<HTMLElement>('[data-pol]');
    if (p) { pattern = p.dataset.p!; step = 0; stop(); draw(); }
    else if (pol) { policy = pol.dataset.pol as Policy; draw(); }
    else if (t.closest('#ce-next')) { stop(); step = Math.min(step + 1, seqOf().length); draw(); }
    else if (t.closest('#ce-prev')) { stop(); step = Math.max(step - 1, 0); draw(); }
    else if (t.closest('#ce-play')) {
      if (timer) { stop(); return; }
      if (step >= seqOf().length) step = 0;
      $('#ce-play', root)!.textContent = 'Pause';
      timer = window.setInterval(() => { if (step >= seqOf().length) { stop(); return; } step++; draw(); }, 380);
    }
  });
  $('#ce-cs', root)!.addEventListener('input', (e) => { cap = Number((e.target as HTMLInputElement).value); step = 0; stop(); draw(); });
  ($('#ce-ci', root) as HTMLInputElement).value = custom;
  $('#ce-ci', root)!.addEventListener('input', (e) => { custom = (e.target as HTMLInputElement).value; step = 0; stop(); draw(); });
  draw();
}

/* ------------------------------------------------------------ load balancing */

function loadBalancing(host: HTMLElement) {
  const algos: { id: Algo; label: string }[] = [
    { id: 'rr', label: 'Round robin' }, { id: 'random', label: 'Random' }, { id: 'least', label: 'Least connections' },
    { id: 'p2c', label: 'Power of two choices' }, { id: 'wrr', label: 'Weighted round robin' }, { id: 'hash', label: 'IP hash' },
  ];
  const FAIL_AT = 60;
  let algo: Algo = 'rr';
  let mixed = false;
  let hot = false;
  let failure = false;
  let checks = false;
  let servers = 4;
  let frame = 0;

  const root = shell(host, 'lb', 'Load balancing simulator', { eyebrow: 'Simulation', title: 'Same traffic, different routing', desc: 'Most requests are quick, some are slow. Servers work through their own queue.' }, `
    <div class="lb-controls">
      <div class="seg small" id="lb-algo" role="group" aria-label="Algorithm">${algos.map((a) => `<button type="button" data-a="${a.id}"><b>${a.label}</b></button>`).join('')}</div>
      <div class="lb-toggles">
        <label class="lab-check"><input type="checkbox" id="lb-mixed" /> Mixed hardware <small>(speeds 1, 1, 2, 3…)</small></label>
        <label class="lab-check"><input type="checkbox" id="lb-hot" /> One very busy client</label>
        <label class="lab-check"><input type="checkbox" id="lb-fail" /> Server 1 dies at tick ${FAIL_AT}</label>
        <label class="lab-check"><input type="checkbox" id="lb-checks" /> Health checks <small>(notice after ${DETECT_TICKS} ticks)</small></label>
        <label class="lab-range"><span>Servers <b id="lb-n">4</b></span><input type="range" min="2" max="6" value="4" id="lb-ns" aria-label="Number of servers" /></label>
      </div>
    </div>
    <div class="lb-stage"><div class="lb-play" id="lb-play"><span id="lb-tick" class="ch-note"></span></div><div class="lb-servers" id="lb-servers"></div></div>
    <p class="lb-goal" id="lb-goal" hidden></p>
    <div class="lb-table-wrap" tabindex="0" role="region" aria-label="Results by algorithm (scrolls sideways on small screens)"><table class="lb-table" id="lb-table"></table></div>
    <p class="ch-note lb-runs">Latency and failure columns are the median of 20 runs with different traffic; the range shows the best and worst run. One run on its own can mislead: the same algorithm can look good or bad depending on luck.</p>`);

  const speedsOf = () => Array.from({ length: servers }, (_, i) => (mixed ? [1, 1, 2, 3, 3, 4][i] : 1));
  const optsOf = (): LbOptions => (failure ? { failAt: FAIL_AT, healthChecks: checks } : {});
  let sims: Record<Algo, LbResult>;
  let sums: Record<Algo, LbSummary>;

  const compute = () => {
    const sp = speedsOf(), o = optsOf();
    sims = Object.fromEntries(algos.map((a) => [a.id, simulateLb(a.id, sp, hot, 21, o)])) as Record<Algo, LbResult>;
    sums = Object.fromEntries(algos.map((a) => [a.id, summarizeLb(a.id, sp, hot, o)])) as Record<Algo, LbSummary>;
    frame = 0;
  };

  const drawServers = () => {
    const r = sims[algo], sp = speedsOf();
    const f = r.frames[Math.min(frame, r.frames.length - 1)];
    const top = Math.max(8, r.maxQueue);
    const down = failure && frame >= FAIL_AT;
    const removed = down && checks && frame >= FAIL_AT + DETECT_TICKS;
    $('#lb-servers', root)!.innerHTML = f.map((q, i) => {
      const state = i === 0 && removed ? 'removed' : i === 0 && down ? 'down' : '';
      const note = state === 'removed' ? 'taken out of rotation' : state === 'down' ? `dead · ${q} stuck` : `${sp[i]}× speed · ${q} queued`;
      return `<div class="lb-server ${state}"><div class="lb-stack" style="--top:${top}">${'<i></i>'.repeat(Math.min(q, top))}</div>
        <b>Server ${i + 1}</b><small>${note}</small></div>`;
    }).join('');
    $('#lb-tick', root)!.textContent = `tick ${Math.min(frame + 1, r.frames.length)} / ${r.frames.length}`;
  };
  const drawTable = () => {
    const sp = speedsOf();
    const best = Math.min(...algos.map((a) => sums[a.id].p95));
    $('#lb-table', root)!.innerHTML = `<thead><tr><th>Algorithm</th><th>Mean latency</th><th>p95 latency <small>(range)</small></th>${failure ? '<th>Failed requests</th>' : ''}<th>Longest queue</th><th>Requests per server <small>(run shown)</small></th></tr></thead><tbody>${algos.map((a) => {
      const r = sims[a.id], m = sums[a.id];
      const tot = r.served.reduce((x, y) => x + y, 0);
      return `<tr class="${a.id === algo ? 'on' : ''}" data-a="${a.id}"><td><b>${a.label}</b></td><td>${m.mean.toFixed(1)}</td><td class="${m.p95 === best ? 'best' : ''}">${m.p95} <small>(${m.p95Low}–${m.p95High})</small></td>${failure ? `<td class="${m.failed > 5 ? 'bad' : ''}">${m.failed}</td>` : ''}<td>${m.maxQueue}</td>
        <td><span class="lb-mini">${r.served.map((s, i) => `<i title="Server ${i + 1}: ${s} requests (${sp[i]}× speed)" style="height:${Math.max(4, (s / tot) * 90)}px"></i>`).join('')}</span></td></tr>`;
    }).join('')}</tbody>`;
    // A goal for the failure scenario: few failed requests without a slow tail.
    const goal = $('#lb-goal', root)!;
    goal.hidden = !failure;
    if (failure) {
      const m = sums[algo];
      const ok = m.failed <= 2 && m.p95 <= 25;
      goal.className = `lb-goal${ok ? ' ok' : ''}`;
      goal.innerHTML = `<b>Challenge:</b> a server dies. Get the median of failed requests to 2 or fewer with p95 at 25 or below. <span>${esc(algos.find((a) => a.id === algo)!.label)}: ${m.failed} failed, p95 ${m.p95}. ${ok ? '<strong>Done.</strong>' : 'Not yet.'}</span>`;
    }
  };
  const draw = () => {
    $$('#lb-algo button', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.a === algo)));
    $('#lb-n', root)!.textContent = String(servers);
    drawServers(); drawTable();
  };
  const pl = player(root, {
    ms: 90, autoplay: true,
    step: () => { frame = (frame + 1) % sims[algo].frames.length; drawServers(); },
    reset: () => { frame = 0; drawServers(); },
    describe: () => `Tick ${frame + 1}: queues ${sims[algo].frames[frame].join(', ')}.`,
  });
  $('#lb-play', root)!.prepend(pl.el);

  root.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
    if (a) { algo = a.dataset.a as Algo; frame = 0; draw(); }
  });
  const toggle = (id: string, set: (v: boolean) => void) => $(id, root)!.addEventListener('change', (e) => { set((e.target as HTMLInputElement).checked); compute(); draw(); });
  toggle('#lb-mixed', (v) => (mixed = v));
  toggle('#lb-hot', (v) => (hot = v));
  toggle('#lb-fail', (v) => (failure = v));
  toggle('#lb-checks', (v) => (checks = v));
  $('#lb-ns', root)!.addEventListener('input', (e) => { servers = Number((e.target as HTMLInputElement).value); compute(); draw(); });
  compute(); draw();
}

/* ------------------------------------------------------------ CAP lab */

function capLab(host: HTMLElement) {
  let st: CapState = createCap('cp');
  let log: CapEvent[] = [];

  const root = shell(host, 'cap', 'CAP theorem lab', { eyebrow: 'Simulation', title: 'Three replicas and a flaky network', desc: 'Nodes 1 and 2 can always talk to each other. A partition cuts node 3 off from them.' }, `
    <div class="cap-controls">
      <div class="seg small" id="cap-mode" role="group" aria-label="Consistency mode"><button type="button" data-m="cp"><b>CP</b><small>consistency first</small></button><button type="button" data-m="ap"><b>AP</b><small>availability first</small></button></div>
      <button type="button" class="chip-btn" id="cap-part" aria-pressed="false">Cut the network</button>
      <button type="button" class="chip-btn" id="cap-reset">Reset</button>
    </div>
    <div class="cap-stage" id="cap-stage"></div>
    <div class="cap-log" id="cap-log" aria-live="polite" role="log"></div>`);

  const push = (e?: CapEvent) => { if (e) log = [e, ...log].slice(0, 7); };

  const draw = () => {
    $$('#cap-mode button', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === st.mode)));
    const part = $('#cap-part', root)!;
    part.textContent = st.partitioned ? 'Heal the network' : 'Cut the network';
    part.setAttribute('aria-pressed', String(st.partitioned));
    const latest = Math.max(...st.nodes.map((n) => n.ts));
    $('#cap-stage', root)!.innerHTML = `
      <div class="cap-net${st.partitioned ? ' cut' : ''}">
        ${st.nodes.map((n, i) => `
          <div class="cap-node${n.ts < latest ? ' stale' : ''}${st.partitioned && i === 2 ? ' island' : ''}">
            <b>Node ${i + 1}</b>
            <span class="cap-val">${esc(n.value)}</span>
            ${n.ts < latest ? '<em>stale</em>' : '<em class="fresh">current</em>'}
            <div class="cap-btns"><button type="button" class="chip-btn" data-w="${i}">Write</button><button type="button" class="chip-btn" data-r="${i}">Read</button></div>
          </div>`).join('')}
        <div class="cap-link l12"></div><div class="cap-link l13"></div><div class="cap-link l23"></div>
      </div>`;
    $('#cap-log', root)!.innerHTML = log.length
      ? log.map((l) => `<p class="${l.kind}">${esc(l.text)}</p>`).join('')
      : '<p class="info">Write a value, cut the network, then try reading and writing on node 3.</p>';
  };

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const w = t.closest<HTMLElement>('[data-w]'), r = t.closest<HTMLElement>('[data-r]'), m = t.closest<HTMLElement>('[data-m]');
    if (w) { const out = capWrite(st, Number(w.dataset.w)); st = out.state; push(out.event); }
    else if (r) push(capRead(st, Number(r.dataset.r)));
    else if (m) { st = { ...st, mode: m.dataset.m as CapState['mode'] }; push({ kind: 'info', text: st.mode === 'cp' ? 'CP mode: a node without a majority refuses to answer.' : 'AP mode: every node always answers with what it has.' }); }
    else if (t.closest('#cap-part')) { const out = capSetPartition(st, !st.partitioned); st = out.state; push(out.event); }
    else if (t.closest('#cap-reset')) { st = createCap(st.mode); log = []; }
    else return;
    draw();
  });
  draw();
}

export const labWidgets: Record<string, (host: HTMLElement) => void> = {
  estimator,
  'consistent-hash': consistentHash,
  'cache-eviction': cacheEviction,
  'load-balancing': loadBalancing,
  'cap-lab': capLab,
};
