// Interactive visuals: replication, sharding, message queues, DNS, CDN, TCP vs UDP, and the load curve.
// The behaviour is in src/lib/*; this file only draws it and wires the controls.

import { $, $$, esc, reducedMotion, shell, ticker } from './lab-kit';
import * as repl from '../lib/replication';
import { emptyQueue, step as queueStep, waitTicks, PRESSURE_AT, type QueueParams, type QueueState } from '../lib/queue-sim';
import { simulate } from '../lib/transport';
import { assign, CITIES, imbalance, load, makeUsers, shardsTouched, type Query, type Strategy } from '../lib/sharding';
import { resolve as dnsResolve, type DnsOptions } from '../lib/dns';
import * as cdn from '../lib/cdn';
import { curve, responseMs, serversFor, MAX_UTILISATION } from '../lib/load-curve';
import { getProgress } from '../lib/progress';
import { architectureAt, newAt } from '../lib/scaling-story';

const TONES = ['#0c7a73', '#4f5bd5', '#c4690a', '#cc3a5d', '#8a4fd0', '#0b84b8', '#9a7b0a', '#5f8a2a'];

/* ------------------------------------------------------------ replication */

function replication(host: HTMLElement) {
  let s = repl.create('async', 2);
  let readMsg = '';
  const root = shell(host, 'v-repl', 'Replication', { eyebrow: 'Simulation', title: 'Primary and replicas', desc: 'Writes go to the primary and are copied to the replicas. Watch what a read sees, and what a crash costs.' }, `
    <div class="vis-controls">
      <div class="seg small" role="group" aria-label="Replication mode">
        <button type="button" data-mode="async"><b>Asynchronous</b><small>reply first, copy later</small></button>
        <button type="button" data-mode="sync"><b>Synchronous</b><small>wait for every replica</small></button>
      </div>
      <label class="lab-range"><span>Replication delay <b id="r-lag">2</b> ticks</span><input type="range" id="r-lag-in" min="1" max="5" value="2" aria-label="Replication delay in ticks" /></label>
    </div>
    <div class="vis-actions">
      <button type="button" class="btn primary" data-act="write">Write</button>
      <button type="button" class="btn" data-act="tick">Let a tick pass</button>
      <button type="button" class="btn" data-act="crash">Crash the primary</button>
      <button type="button" class="btn" data-act="promote">Promote a replica</button>
      <button type="button" class="chip-btn" data-act="reset">Reset</button>
    </div>
    <div class="v-repl-stage" id="r-stage"></div>
    <div class="vis-status" id="r-status" role="status" aria-live="polite"></div>
    <ol class="vis-log" id="r-log" aria-label="What happened"></ol>`);

  const draw = () => {
    $$('[data-mode]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === s.mode)));
    $('#r-lag', root)!.textContent = String(s.lag);
    const p = repl.primary(s);
    const anyDown = s.nodes.some((n) => !n.up);
    $('#r-stage', root)!.innerHTML = `
      <div class="v-client"><b>Client</b><span>was told <strong>v${s.acked}</strong> is saved</span><small>tick ${s.tick}</small></div>
      <div class="v-nodes">${s.nodes.map((n) => {
        const inflight = s.pending.filter((m) => m.to === n.id);
        const behind = n.up ? Math.max(0, s.acked - n.version) : 0;
        return `<div class="v-node${n.up ? '' : ' down'}${n.primary ? ' primary' : ''}${behind ? ' behind' : ''}">
          <span class="v-role">${n.primary ? 'Primary' : 'Replica'}${n.up ? '' : ' (down)'}</span>
          <b class="v-ver">v${n.version}</b>
          <span class="v-sub">${!n.up ? 'unreachable' : behind ? `${behind} behind` : 'up to date'}</span>
          ${inflight.length ? `<span class="v-flight">${inflight.map((m) => `<i title="v${m.version} arrives in ${m.deliverAt - s.tick} tick(s)">v${m.version} · ${m.deliverAt - s.tick}</i>`).join('')}</span>` : '<span class="v-flight"></span>'}
          <button type="button" class="chip-btn" data-read="${n.id}">Read here</button>
          ${!n.up ? `<button type="button" class="chip-btn" data-recover="${n.id}">Bring back</button>` : ''}
        </div>`;
      }).join('')}</div>`;
    ($('[data-act="write"]', root) as HTMLButtonElement).disabled = !p;
    ($('[data-act="crash"]', root) as HTMLButtonElement).disabled = !p;
    ($('[data-act="promote"]', root) as HTMLButtonElement).disabled = !!p || !s.nodes.some((n) => n.up);
    $('#r-status', root)!.textContent = readMsg;
    $('#r-log', root)!.innerHTML = s.log.map((l) => `<li>${esc(l)}</li>`).join('') || '<li class="muted">Press Write to begin.</li>';
    void anyDown;
  };

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    const read = t.closest<HTMLElement>('[data-read]');
    const rec = t.closest<HTMLElement>('[data-recover]');
    const mode = t.closest<HTMLElement>('[data-mode]');
    if (mode) { s = repl.create(mode.dataset.mode as repl.Mode, s.lag); readMsg = ''; }
    else if (read) readMsg = repl.read(s, Number(read.dataset.read)).message;
    else if (rec) s = repl.recover(s, Number(rec.dataset.recover));
    else if (act === 'write') s = repl.write(s);
    else if (act === 'tick') s = repl.advance(s);
    else if (act === 'crash') { s = repl.crashPrimary(s); readMsg = ''; }
    else if (act === 'promote') { s = repl.promote(s).state; readMsg = ''; }
    else if (act === 'reset') { s = repl.create(s.mode, s.lag); readMsg = ''; }
    else return;
    draw();
  });
  $('#r-lag-in', root)!.addEventListener('input', (e) => { s = { ...s, lag: Number((e.target as HTMLInputElement).value) }; draw(); });
  draw();
}

/* ------------------------------------------------------------ sharding */

function sharding(host: HTMLElement) {
  let strategy: Strategy = 'range';
  let shards = 4;
  let power = true;
  const root = shell(host, 'v-sharding', 'Sharding', { eyebrow: 'Simulation', title: '600 users, split across shards', desc: 'Pick how users are assigned to shards, then look at how much data and traffic each one gets, and which queries have to ask every shard.' }, `
    <div class="vis-controls">
      <div class="seg small" role="group" aria-label="Sharding strategy">
        <button type="button" data-s="range"><b>By surname</b><small>A to G, H to N, ...</small></button>
        <button type="button" data-s="hash"><b>By hash of ID</b><small>pseudo-random</small></button>
        <button type="button" data-s="directory"><b>Lookup table</b><small>placed by load</small></button>
      </div>
      <label class="lab-range"><span>Shards <b id="s-n">4</b></span><input type="range" id="s-n-in" min="2" max="8" value="4" aria-label="Number of shards" /></label>
      <label class="lab-check"><input type="checkbox" id="s-power" checked /> A few power users (5% of users, 14× the traffic)</label>
    </div>
    <div class="v-shards" id="s-bars"></div>
    <p class="vis-status" id="s-verdict" role="status" aria-live="polite"></p>
    <h4 class="vis-h">How many shards must each query ask?</h4>
    <div class="v-queries" id="s-queries"></div>`);

  const draw = () => {
    const users = makeUsers(600, power);
    const a = assign(strategy, users, shards);
    const l = load(users, a, shards);
    const maxUsers = Math.max(...l.count), maxTraffic = Math.max(...l.traffic);
    const ib = imbalance(l.traffic);
    $$('[data-s]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.s === strategy)));
    $('#s-n', root)!.textContent = String(shards);
    $('#s-bars', root)!.innerHTML = l.count.map((c, i) => `
      <div class="v-shard"><b>Shard ${i + 1}</b>
        <div class="v-bar" title="${c} users"><i style="height:${(c / maxUsers) * 100}%;background:${TONES[i]}33;border-color:${TONES[i]}"></i><span>${c}</span></div>
        <small>users</small>
        <div class="v-bar traffic" title="traffic share ${(l.traffic[i] / l.traffic.reduce((x, y) => x + y, 0) * 100).toFixed(0)}%"><i style="height:${(l.traffic[i] / maxTraffic) * 100}%;background:${TONES[i]}"></i><span>${(l.traffic[i] / l.traffic.reduce((x, y) => x + y, 0) * 100).toFixed(0)}%</span></div>
        <small>traffic</small></div>`).join('');
    const spread = Math.max(...l.count) / Math.max(1, Math.min(...l.count));
    $('#s-verdict', root)!.textContent = `The busiest shard handles ${ib.toFixed(2)}× its fair share of traffic. The biggest shard holds ${spread.toFixed(1)}× as many users as the smallest.`;
    const qs: [Query, string][] = [['by-key', 'Look up one user by the shard key'], ['name-prefix', 'Find users whose surname starts with “M”'], ['by-city', `Find users in ${CITIES[0]}`]];
    $('#s-queries', root)!.innerHTML = qs.map(([q, label]) => {
      const n = shardsTouched(q, strategy, shards);
      return `<div class="v-query"><span>${esc(label)}</span><span class="v-dots" role="img" aria-label="${n} of ${shards} shards">${Array.from({ length: shards }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span><b>${n === shards && shards > 1 ? 'all ' + shards + ' (scatter-gather)' : n + ' shard'}</b></div>`;
    }).join('');
  };
  root.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-s]'); if (b) { strategy = b.dataset.s as Strategy; draw(); } });
  $('#s-n-in', root)!.addEventListener('input', (e) => { shards = Number((e.target as HTMLInputElement).value); draw(); });
  $('#s-power', root)!.addEventListener('change', (e) => { power = (e.target as HTMLInputElement).checked; draw(); });
  draw();
}

/* ------------------------------------------------------------ message queue and back pressure */

function messageQueue(host: HTMLElement) {
  const p: QueueParams = { produce: 6, consumers: 2, perConsumer: 2, capacity: 40, backPressure: false };
  let state: QueueState = emptyQueue();
  let history: number[] = [];
  const root = shell(host, 'v-queue', 'Message queue', { eyebrow: 'Simulation', title: 'A queue between two speeds', desc: 'A queue smooths out bursts. It cannot fix a producer that is permanently faster than its consumers. Change the rates and see what gives.' }, `
    <div class="vis-controls vis-grid">
      <label class="lab-range"><span>Producer sends <b id="q-p">6</b> / tick</span><input type="range" id="q-p-in" min="0" max="12" value="6" aria-label="Producer rate per tick" /></label>
      <label class="lab-range"><span>Consumers <b id="q-c">2</b> × 2 / tick</span><input type="range" id="q-c-in" min="1" max="8" value="2" aria-label="Number of consumers" /></label>
      <label class="lab-range"><span>Queue holds <b id="q-cap">40</b> messages</span><input type="range" id="q-cap-in" min="10" max="80" step="10" value="40" aria-label="Queue capacity" /></label>
      <label class="lab-check"><input type="checkbox" id="q-bp" /> Back pressure: slow the producer when the queue is ${Math.round(PRESSURE_AT * 100)}% full</label>
    </div>
    <div class="vis-actions"><button type="button" class="btn primary" id="q-play">Pause</button><button type="button" class="chip-btn" id="q-reset">Reset</button></div>
    <div class="v-qbox" id="q-box" role="img" aria-label="The queue"></div>
    <svg class="v-spark" id="q-spark" viewBox="0 0 300 50" preserveAspectRatio="none" role="img" aria-label="Queue depth over time"></svg>
    <dl class="vis-stats" id="q-stats"></dl>
    <p class="vis-status" id="q-verdict" role="status" aria-live="polite"></p>`);

  const draw = () => {
    $('#q-p', root)!.textContent = String(p.produce);
    $('#q-c', root)!.textContent = String(p.consumers);
    $('#q-cap', root)!.textContent = String(p.capacity);
    const cells = Math.min(p.capacity, 80);
    $('#q-box', root)!.innerHTML = Array.from({ length: cells }, (_, i) => `<i class="${i < state.depth ? 'full' : ''}${i >= PRESSURE_AT * cells && p.backPressure ? ' zone' : ''}"></i>`).join('');
    const pts = history.slice(-150).map((d, i, a) => `${(i / Math.max(1, a.length - 1)) * 300},${50 - (d / p.capacity) * 48}`).join(' ');
    $('#q-spark', root)!.innerHTML = `<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.6" vector-effect="non-scaling-stroke"/>`;
    const wait = waitTicks(state.depth, p);
    $('#q-stats', root)!.innerHTML = [['In the queue', `${state.depth} / ${p.capacity}`], ['Wait for a new message', `${wait.toFixed(1)} ticks`], ['Delivered', state.consumed], ['Dropped', state.dropped], ['Held back by back pressure', Math.round(state.throttled)]]
      .map(([k, v]) => `<div class="${k === 'Dropped' && Number(v) > 0 ? 'bad' : ''}"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    const cap = p.consumers * p.perConsumer;
    $('#q-verdict', root)!.textContent = p.produce <= cap
      ? `Consumers can handle ${cap} per tick, which is at least what is produced (${p.produce}), so the queue stays short.`
      : state.dropped > 0 ? `Producer (${p.produce}) outpaces consumers (${cap}). The queue is full and messages are being dropped.`
      : p.backPressure ? `Producer (${p.produce}) outpaces consumers (${cap}), but back pressure is holding it to what the consumers can take.`
      : `Producer (${p.produce}) outpaces consumers (${cap}). The queue is filling and will start dropping when it is full.`;
  };
  const reset = () => { state = emptyQueue(); history = [0]; draw(); };
  const timer = ticker(root, () => { state = queueStep(state, p); history.push(state.depth); draw(); }, 160);

  const bind = (id: string, key: 'produce' | 'consumers' | 'capacity') => $(id, root)!.addEventListener('input', (e) => { p[key] = Number((e.target as HTMLInputElement).value); draw(); });
  bind('#q-p-in', 'produce'); bind('#q-c-in', 'consumers'); bind('#q-cap-in', 'capacity');
  $('#q-bp', root)!.addEventListener('change', (e) => { p.backPressure = (e.target as HTMLInputElement).checked; });
  $('#q-reset', root)!.addEventListener('click', reset);
  $('#q-play', root)!.addEventListener('click', (e) => { const b = e.currentTarget as HTMLElement; if (timer.running()) { timer.stop(); b.textContent = 'Play'; } else { timer.start(); b.textContent = 'Pause'; } });
  reset();
  if (!reducedMotion()) timer.start(); else $('#q-play', root)!.textContent = 'Play';
}

/* ------------------------------------------------------------ DNS */

function dns(host: HTMLElement) {
  const opts: DnsOptions = { browserCache: false, osCache: false, resolverCache: false, knowsTld: false };
  let shownUpTo = -1; // steps revealed so far during the animation
  let shown = false;
  const root = shell(host, 'v-dns', 'DNS lookup', { eyebrow: 'Walkthrough', title: 'From a name to an address', desc: 'Look up www.example.com. Tick the caches that already know the answer and see how much of the walk disappears.' }, `
    <div class="vis-controls">
      <label class="lab-check"><input type="checkbox" data-o="browserCache" /> Browser has it cached</label>
      <label class="lab-check"><input type="checkbox" data-o="osCache" /> Operating system has it cached</label>
      <label class="lab-check"><input type="checkbox" data-o="resolverCache" /> Resolver has it cached</label>
      <label class="lab-check"><input type="checkbox" data-o="knowsTld" /> Resolver already knows the .com servers</label>
    </div>
    <div class="vis-actions"><button type="button" class="btn primary" id="d-go">Look up www.example.com</button></div>
    <ol class="v-dnssteps" id="d-steps"></ol>
    <p class="vis-status" id="d-verdict" role="status" aria-live="polite"></p>`);

  const draw = () => {
    const r = dnsResolve(opts);
    const max = Math.max(...r.steps.map((x) => x.ms), 1);
    $('#d-steps', root)!.innerHTML = r.steps.map((st, i) => {
      const visible = shown && i <= shownUpTo;
      return `<li class="${!shown ? 'idle' : visible ? (st.asked ? 'asked' : 'skipped') : 'wait'}">
        <span class="v-dn">${i + 1}</span>
        <div><b>${esc(st.label)}</b><small>${visible ? esc(st.note) : 'Waiting…'}</small></div>
        <span class="v-ms"><i style="width:${visible && st.asked ? Math.max(4, (st.ms / max) * 100) : 0}%"></i><em>${visible ? (st.asked ? st.ms + ' ms' : 'skipped') : ''}</em></span></li>`;
    }).join('');
    const done = shown && shownUpTo >= r.steps.length - 1;
    $('#d-verdict', root)!.textContent = done ? `The answer came from ${r.answeredBy}. Total: ${r.totalMs} ms. ${r.totalMs < 5 ? 'No network trip at all.' : r.answeredBy === 'the authoritative server' ? 'Tick some caches and look up again to see it shrink.' : ''}` : '';
  };
  let timer: number | undefined;
  $('#d-go', root)!.addEventListener('click', () => {
    const r = dnsResolve(opts);
    shown = true; shownUpTo = -1;
    if (timer) clearInterval(timer);
    if (reducedMotion()) { shownUpTo = r.steps.length - 1; draw(); return; }
    timer = window.setInterval(() => { shownUpTo++; draw(); if (shownUpTo >= r.steps.length - 1 || !root.isConnected) clearInterval(timer); }, 420);
    draw();
  });
  root.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.o) { opts[el.dataset.o as keyof DnsOptions] = el.checked; shown = false; shownUpTo = -1; if (timer) clearInterval(timer); draw(); }
  });
  draw();
}

/* ------------------------------------------------------------ CDN */

function cdnVisual(host: HTMLElement) {
  let state = cdn.create('pull', 4);
  let history: { region: cdn.Region; by: string; ms: number; reason: string; now: number }[] = [];
  const names: Record<cdn.Region, string> = { us: 'United States', eu: 'Europe', asia: 'Asia' };
  const root = shell(host, 'v-cdn', 'Content delivery network', { eyebrow: 'Simulation', title: 'Edge servers near the user', desc: 'The origin is in the United States. Request a file from different parts of the world with and without a CDN, and watch the copy at the edge appear and expire.' }, `
    <div class="vis-controls">
      <div class="seg small" role="group" aria-label="CDN mode">
        <button type="button" data-m="none"><b>No CDN</b></button>
        <button type="button" data-m="pull"><b>Pull CDN</b><small>edge fetches on first request</small></button>
        <button type="button" data-m="push"><b>Push CDN</b><small>you upload to every edge</small></button>
      </div>
      <label class="lab-range"><span>Copy stays fresh for <b id="c-ttl">4</b> ticks (TTL)</span><input type="range" id="c-ttl-in" min="1" max="10" value="4" aria-label="Time to live in ticks" /></label>
    </div>
    <div class="v-map" id="c-map"></div>
    <div class="vis-actions">
      <span class="vis-label">Request the file from:</span>
      ${cdn.REGIONS.map((r) => `<button type="button" class="btn" data-req="${r}">${names[r]}</button>`).join('')}
      <button type="button" class="chip-btn" data-act="time">Let a tick pass</button>
      <button type="button" class="chip-btn" data-act="purge">Purge the edges</button>
    </div>
    <p class="vis-status" id="c-verdict" role="status" aria-live="polite"></p>
    <ol class="vis-log" id="c-log" aria-label="Requests so far"></ol>`);

  const reset = (mode: cdn.CdnMode) => { state = cdn.create(mode, state.ttl); history = []; };
  const draw = () => {
    $$('[data-m]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === state.mode)));
    $('#c-ttl', root)!.textContent = String(state.ttl);
    ($('#c-ttl-in', root) as HTMLInputElement).disabled = state.mode !== 'pull';
    $('#c-map', root)!.innerHTML = `
      <div class="v-origin"><b>Origin</b><small>United States</small></div>
      <div class="v-edges">${cdn.REGIONS.map((r) => {
        const at = state.edges[r];
        const fresh = state.mode !== 'none' && at !== null && (state.mode === 'push' || state.now - at < state.ttl);
        const age = at === null ? '' : state.mode === 'push' ? 'pushed' : `${Math.max(0, state.ttl - (state.now - at))} tick(s) left`;
        return `<div class="v-edge ${state.mode === 'none' ? 'off' : fresh ? 'warm' : at !== null ? 'stale' : 'cold'}">
          <b>${names[r]}</b><small>${state.mode === 'none' ? 'no edge' : fresh ? `has a copy · ${age}` : at !== null ? 'copy expired' : 'empty'}</small>
          <span class="v-lat">${state.mode === 'none' ? cdn.ORIGIN_MS[r] : cdn.EDGE_MS} ms to ${state.mode === 'none' ? 'origin' : 'edge'}${state.mode !== 'none' ? ` · ${cdn.ORIGIN_MS[r]} ms edge to origin` : ''}</span></div>`;
      }).join('')}</div>`;
    const last = history[0];
    $('#c-verdict', root)!.textContent = last ? `${names[last.region]}: served by the ${last.by} in ${last.ms} ms. ${last.reason}` : 'Request the file to begin.';
    $('#c-log', root)!.innerHTML = history.slice(0, 8).map((h) => `<li><b>${names[h.region]}</b> · tick ${h.now} · ${h.by === 'edge' ? 'edge hit' : 'went to the origin'} · <strong>${h.ms} ms</strong></li>`).join('') || '<li class="muted">Nothing requested yet.</li>';
  };
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const m = t.closest<HTMLElement>('[data-m]'), req = t.closest<HTMLElement>('[data-req]'), act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (m) reset(m.dataset.m as cdn.CdnMode);
    else if (req) { const r = req.dataset.req as cdn.Region; const out = cdn.request(state, r); state = out.state; history.unshift({ region: r, by: out.by, ms: out.ms, reason: out.reason, now: state.now }); }
    else if (act === 'time') state = cdn.advance(state);
    else if (act === 'purge') state = cdn.purge(state);
    else return;
    draw();
  });
  $('#c-ttl-in', root)!.addEventListener('input', (e) => { state = { ...state, ttl: Number((e.target as HTMLInputElement).value) }; draw(); });
  draw();
}

/* ------------------------------------------------------------ TCP vs UDP */

function transport(host: HTMLElement) {
  let loss = 15, rtt = 80, seed = 5;
  const COUNT = 16;
  const root = shell(host, 'v-tcp', 'TCP and UDP', { eyebrow: 'Simulation', title: 'The same 16 packets, two protocols', desc: 'Packets leave 10 ms apart over a link that drops some of them. TCP guarantees delivery and order; UDP does not wait for anyone.' }, `
    <div class="vis-controls vis-grid">
      <label class="lab-range"><span>Packet loss <b id="t-loss">15</b>%</span><input type="range" id="t-loss-in" min="0" max="40" value="15" aria-label="Packet loss percent" /></label>
      <label class="lab-range"><span>Round trip <b id="t-rtt">80</b> ms</span><input type="range" id="t-rtt-in" min="20" max="200" step="10" value="80" aria-label="Round trip time in milliseconds" /></label>
      <button type="button" class="chip-btn" id="t-again">Roll the dice again</button>
    </div>
    <div class="v-lanes" id="t-lanes" tabindex="0" role="region" aria-label="Packet timelines (scroll sideways on small screens)"></div>
    <dl class="vis-stats" id="t-stats"></dl>
    <p class="vis-status" id="t-verdict" role="status" aria-live="polite"></p>`);

  const lane = (proto: 'tcp' | 'udp', maxT: number) => {
    const r = simulate(proto, COUNT, loss, rtt, seed);
    const x = (t: number) => 8 + (t / maxT) * 584;
    let svg = '';
    if (proto === 'tcp' && r.handshakeMs) svg += `<rect x="${x(0)}" y="22" width="${x(r.handshakeMs) - x(0)}" height="10" rx="3" fill="var(--hue-fundamentals)" opacity=".35"/><text x="${x(r.handshakeMs) + 5}" y="31" class="v-t">handshake ${r.handshakeMs} ms</text>`;
    r.packets.forEach((p) => {
      const rto = rtt * 2;
      for (let k = 0; k < p.sends; k++) {
        const at = p.sentAt + k * rto;
        const lostCopy = proto === 'udp' ? p.lost : k < p.sends - 1;
        svg += lostCopy
          ? `<g class="v-lost"><title>packet ${p.n + 1}: lost${proto === 'tcp' ? ', resent' : ''}</title><line x1="${x(at) - 3}" y1="40" x2="${x(at) + 3}" y2="46" /><line x1="${x(at) + 3}" y1="40" x2="${x(at) - 3}" y2="46"/></g>`
          : `<circle cx="${x(at)}" cy="43" r="3.4" fill="${k > 0 ? 'var(--hue-data)' : 'var(--accent)'}"><title>packet ${p.n + 1}${k > 0 ? ' (resent)' : ''}</title></circle>`;
      }
      if (p.deliveredAt !== null) {
        const stalled = p.deliveredAt - (p.arrivedAt ?? p.deliveredAt);
        if (stalled > 0) svg += `<line x1="${x(p.arrivedAt!)}" y1="62" x2="${x(p.deliveredAt)}" y2="62" stroke="var(--hue-data)" stroke-width="2" opacity=".6"><title>packet ${p.n + 1} waited ${Math.round(stalled)} ms for earlier packets</title></line>`;
        svg += `<rect x="${x(p.deliveredAt) - 2}" y="66" width="4" height="9" rx="1" fill="var(--ink-2)"><title>packet ${p.n + 1} reaches the application</title></rect>`;
      }
    });
    return { r, svg: `<svg viewBox="0 0 600 84" class="v-lane" role="img" aria-label="${proto.toUpperCase()} timeline">${svg}<text x="8" y="12" class="v-t strong">${proto.toUpperCase()}</text></svg>` };
  };

  const draw = () => {
    $('#t-loss', root)!.textContent = String(loss);
    $('#t-rtt', root)!.textContent = String(rtt);
    const tcpR = simulate('tcp', COUNT, loss, rtt, seed), udpR = simulate('udp', COUNT, loss, rtt, seed);
    const maxT = Math.max(tcpR.doneAt, udpR.doneAt) + 10;
    const tcp = lane('tcp', maxT), udp = lane('udp', maxT);
    $('#t-lanes', root)!.innerHTML = `${tcp.svg}${udp.svg}<p class="v-legend"><span><i class="ok"></i>sent</span><span><i class="re"></i>resent</span><span><i class="x"></i>lost</span><span><i class="del"></i>reaches the application</span><span><i class="wait"></i>waiting for earlier packets</span></p>`;
    const fmt = (n: number) => `${Math.round(n)} ms`;
    $('#t-stats', root)!.innerHTML = `
      <div><dt>TCP delivered</dt><dd>${tcp.r.delivered} of ${COUNT}</dd></div><div><dt>TCP finished after</dt><dd>${fmt(tcp.r.doneAt)}</dd></div>
      <div><dt>TCP retransmissions</dt><dd>${tcp.r.retransmits}</dd></div><div><dt>Longest TCP stall</dt><dd>${fmt(tcp.r.maxStallMs)}</dd></div>
      <div class="${udp.r.delivered < COUNT ? 'bad' : ''}"><dt>UDP delivered</dt><dd>${udp.r.delivered} of ${COUNT}</dd></div><div><dt>UDP finished after</dt><dd>${fmt(udp.r.doneAt)}</dd></div>`;
    $('#t-verdict', root)!.textContent = loss === 0
      ? `With no loss both deliver everything. TCP only pays for the ${tcp.r.handshakeMs} ms handshake.`
      : `UDP lost ${COUNT - udp.r.delivered} packet${COUNT - udp.r.delivered === 1 ? '' : 's'} and moved on. TCP delivered all ${COUNT} in order, but one lost packet held back everything behind it (up to ${fmt(tcp.r.maxStallMs)}).`;
  };
  $('#t-loss-in', root)!.addEventListener('input', (e) => { loss = Number((e.target as HTMLInputElement).value); draw(); });
  $('#t-rtt-in', root)!.addEventListener('input', (e) => { rtt = Number((e.target as HTMLInputElement).value); draw(); });
  $('#t-again', root)!.addEventListener('click', () => { seed = (seed * 7 + 3) % 1000; draw(); });
  draw();
}

/* ------------------------------------------------------------ the load curve */

function loadCurve(host: HTMLElement) {
  let arrivals = 600, perServer = 100, servers = 8, service = 20;
  const root = shell(host, 'v-curve', 'Load curve', { eyebrow: 'Calculator', title: 'Why the last 20% of capacity is the expensive part', desc: 'Response time rises from the start and then shoots up: twice the idle time at 50% busy, four times at 75%, ten times at 90%. Add servers to move the point back down the curve.' }, `
    <div class="vis-controls vis-grid">
      <label class="lab-range"><span>Incoming <b id="l-a">600</b> requests/s</span><input type="range" id="l-a-in" min="50" max="1500" step="50" value="600" aria-label="Incoming requests per second" /></label>
      <label class="lab-range"><span>Servers <b id="l-n">8</b> (each handles ${perServer}/s)</span><input type="range" id="l-n-in" min="1" max="20" value="8" aria-label="Number of servers" /></label>
      <label class="lab-range"><span>One request takes <b id="l-s">20</b> ms when idle</span><input type="range" id="l-s-in" min="5" max="200" step="5" value="20" aria-label="Idle service time in milliseconds" /></label>
    </div>
    <div class="v-scroll" tabindex="0" role="region" aria-label="Chart (scrolls sideways on small screens)"><svg class="v-chart" id="l-chart" viewBox="0 0 600 276" role="img" aria-label="Response time against utilisation"></svg></div>
    <dl class="vis-stats" id="l-stats"></dl>
    <p class="vis-status" id="l-verdict" role="status" aria-live="polite"></p>`);

  const draw = () => {
    $('#l-a', root)!.textContent = String(arrivals);
    $('#l-n', root)!.textContent = String(servers);
    $('#l-s', root)!.textContent = String(service);
    const util = arrivals / (servers * perServer);
    const over = util >= 1;
    const shown = Math.min(util, MAX_UTILISATION);
    const ms = responseMs(util, service);
    const cap = 12 * service; // y axis tops out at 12× the idle time
    const X = (u: number) => 40 + u * 540, Y = (v: number) => 230 - Math.min(v, cap) / cap * 210;
    const pts = curve(service, 90).filter((p) => p.ms <= cap).map((p) => `${X(p.u).toFixed(1)},${Y(p.ms).toFixed(1)}`).join(' ');
    $('#l-chart', root)!.innerHTML = `
      <rect x="${X(0.7)}" y="20" width="${X(1) - X(0.7)}" height="210" fill="var(--hue-practice)" opacity=".08"/>
      <text x="${X(1) - 6}" y="34" text-anchor="end" class="v-t">queues build fast</text>
      <line x1="40" y1="230" x2="580" y2="230" class="v-axis"/><line x1="40" y1="20" x2="40" y2="230" class="v-axis"/>
      ${[0, 0.25, 0.5, 0.75, 1].map((u) => `<text x="${X(u)}" y="247" text-anchor="middle" class="v-t">${u * 100}%</text>`).join('')}
      <text x="310" y="270" text-anchor="middle" class="v-t">how busy each server is</text>
      <text x="14" y="125" transform="rotate(-90 14 125)" text-anchor="middle" class="v-t">time per request</text>
      ${[1, 4, 8, 12].map((k) => `<text x="36" y="${Y(k * service) + 3}" text-anchor="end" class="v-t">${k * service}</text>`).join('')}
      <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.4"/>
      ${[0.5, 0.75, 0.9].map((u) => `<circle cx="${X(u)}" cy="${Y(responseMs(u, service))}" r="3" fill="var(--ink-2)"/><text x="${X(u) - 6}" y="${Y(responseMs(u, service)) - 8}" text-anchor="end" class="v-t">${Math.round(1 / (1 - u))}×</text>`).join('')}
      <line x1="${X(shown)}" y1="${Y(ms)}" x2="${X(shown)}" y2="230" stroke="var(--ink-3)" stroke-dasharray="3 3"/>
      <circle cx="${X(shown)}" cy="${Y(ms)}" r="6" fill="${over ? 'var(--hue-practice)' : 'var(--accent)'}" stroke="var(--surface)" stroke-width="2"/>`;
    const needed = serversFor(arrivals, perServer, 0.7);
    $('#l-stats', root)!.innerHTML = `
      <div><dt>Each server is</dt><dd>${Math.round(util * 100)}% busy</dd></div>
      <div class="${over ? 'bad' : ''}"><dt>A request takes</dt><dd>${over ? 'unbounded' : `${Math.round(ms)} ms`}</dd></div>
      <div><dt>Slow-down vs idle</dt><dd>${over ? '∞' : `${(ms / service).toFixed(1)}×`}</dd></div>
      <div><dt>Servers to stay under 70%</dt><dd>${needed}</dd></div>`;
    $('#l-verdict', root)!.textContent = over
      ? `Demand (${arrivals}/s) exceeds capacity (${servers * perServer}/s). Requests arrive faster than they are served, so the queue grows without limit.`
      : util > 0.7 ? `At ${Math.round(util * 100)}% busy a ${service} ms request takes ${Math.round(ms)} ms. Adding servers is cheaper than living up here.`
      : `Plenty of headroom: requests take about ${Math.round(ms)} ms.`;
  };
  const bind = (id: string, f: (v: number) => void) => $(id, root)!.addEventListener('input', (e) => { f(Number((e.target as HTMLInputElement).value)); draw(); });
  bind('#l-a-in', (v) => (arrivals = v)); bind('#l-n-in', (v) => (servers = v)); bind('#l-s-in', (v) => (service = v));
  draw();
}

/* ------------------------------------------------------------ the scaling story */

function scaleStory(host: HTMLElement) {
  const prose = host.closest<HTMLElement>('.prose');
  if (!prose) return;
  // The nine stages are ordinary headings and paragraphs in the page, so it reads fine without scripts.
  // Here they are collected and shown one at a time beside a diagram.
  const heads = [...prose.querySelectorAll<HTMLElement>('h3')].filter((h) => /^\d+\./.test((h.firstChild?.textContent ?? '').trim()));
  if (heads.length < 2) return;
  const stages = heads.map((h) => {
    const nodes: HTMLElement[] = [h];
    let n = h.nextElementSibling as HTMLElement | null;
    while (n && n.tagName !== 'H3' && n.tagName !== 'H2') { nodes.push(n); n = n.nextElementSibling as HTMLElement | null; }
    const field = (label: string) => {
      const p = nodes.find((x) => x.tagName === 'P' && x.querySelector('strong')?.textContent?.replace(/\.$/, '') === label);
      if (!p) return '';
      const c = p.cloneNode(true) as HTMLElement;
      c.querySelector('strong')?.remove();
      return c.innerHTML.trim();
    };
    return { title: (h.firstChild?.textContent ?? '').replace(/^\d+\.\s*/, '').trim(), symptom: field('Symptom'), fix: field('Fix'), cost: field('Cost'), nodes };
  });

  const progress = getProgress();
  const saved = progress.get().paths['scaling-story']?.stage ?? 1;
  let stage = Math.min(Math.max(1, saved), stages.length);
  let predict = false;
  let revealed = false;

  const root = shell(host, 'v-story', 'From one user to millions', { eyebrow: 'Guided path', title: 'Grow a system, one bottleneck at a time', desc: 'Step through the stages. Each one adds a single component to fix a symptom, and tells you what it costs.' }, `
    <div class="story-top">
      <ol class="story-steps" id="st-steps" aria-label="Stages"></ol>
      <label class="lab-check"><input type="checkbox" id="st-predict" /> Predict first: show the symptom, then guess the fix</label>
    </div>
    <div class="story-diagram" tabindex="0" role="group" aria-label="Architecture diagram"><svg id="st-svg" viewBox="0 0 800 340" role="img"></svg></div>
    <div class="story-panel" id="st-panel" aria-live="polite"></div>
    <div class="story-nav"><button type="button" class="btn" id="st-prev">Previous stage</button><button type="button" class="btn primary" id="st-next">Next stage</button></div>`);

  // keep the plain-text version available, tucked away
  const details = document.createElement('details');
  details.className = 'story-text';
  details.innerHTML = '<summary>Read all nine stages as plain text</summary>';
  const first = stages[0].nodes[0];
  first.before(details);
  for (const st of stages) for (const n of st.nodes) details.append(n);

  const draw = () => {
    const arch = architectureAt(stage);
    const fresh = new Set(newAt(stage));
    const byId = new Map(arch.components.map((c) => [c.id, c]));
    const edge = (a: string, b: string, dashed?: boolean) => {
      const A = byId.get(a), B = byId.get(b);
      if (!A || !B) return '';
      const x1 = A.x + A.w, y1 = A.y + A.h / 2, x2 = B.x, y2 = B.y + B.h / 2;
      const mid = (x1 + x2) / 2;
      return `<path d="M${x1} ${y1}C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}" fill="none" stroke="var(--ink-3)" stroke-width="1.5" ${dashed ? 'stroke-dasharray="4 4"' : ''} />`;
    };
    $('#st-svg', root)!.setAttribute('aria-label', `Architecture at stage ${stage}: ${arch.components.map((c) => c.label).join(', ')}`);
    $('#st-svg', root)!.innerHTML =
      arch.edges.map((e) => edge(e.from, e.to, e.dashed)).join('') +
      arch.components.map((c) => `
        <g class="st-box${fresh.has(c.id) ? ' new' : ''}${c.ghost ? ' ghost' : ''}">
          <rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="10" />
          <text x="${c.x + c.w / 2}" y="${c.y + c.h / 2 + (c.sub ? -2 : 4)}" text-anchor="middle" class="st-l">${esc(c.label)}</text>
          ${c.sub ? `<text x="${c.x + c.w / 2}" y="${c.y + c.h / 2 + 13}" text-anchor="middle" class="st-s">${esc(c.sub)}</text>` : ''}
          ${fresh.has(c.id) ? `<text x="${c.x + c.w - 6}" y="${c.y + 11}" text-anchor="end" class="st-new">new</text>` : ''}
        </g>`).join('');

    $('#st-steps', root)!.innerHTML = stages.map((_, i) => `<li><button type="button" data-go="${i + 1}" aria-label="Stage ${i + 1}: ${esc(stages[i].title)}" aria-current="${i + 1 === stage ? 'step' : 'false'}" class="${i + 1 < stage ? 'done' : ''}">${i + 1}</button></li>`).join('');

    const st = stages[stage - 1];
    const hide = predict && !revealed;
    $('#st-panel', root)!.innerHTML = `
      <p class="quiz-count">Stage ${stage} of ${stages.length}</p>
      <h4 class="story-title">${esc(st.title)}</h4>
      <div class="story-block"><b>The symptom</b><p>${st.symptom}</p></div>
      ${hide
        ? '<div class="story-block predict"><b>Your turn</b><p>Before you look: what one component or change would you add to fix this, and what would it cost you?</p><button type="button" class="btn primary" id="st-reveal">Show the fix</button></div>'
        : `<div class="story-block"><b>The fix</b><p>${st.fix}</p></div><div class="story-block cost"><b>What it costs</b><p>${st.cost}</p></div>`}`;
    ($('#st-prev', root) as HTMLButtonElement).disabled = stage === 1;
    ($('#st-next', root) as HTMLButtonElement).disabled = stage === stages.length;
    $('#st-next', root)!.textContent = stage === stages.length - 1 ? 'Last stage' : 'Next stage';
  };

  const go = (n: number) => {
    stage = Math.min(Math.max(1, n), stages.length);
    revealed = false;
    progress.update((d) => { d.paths['scaling-story'] = { stage }; });
    draw();
  };
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const g = t.closest<HTMLElement>('[data-go]');
    if (g) go(Number(g.dataset.go));
    else if (t.closest('#st-prev')) go(stage - 1);
    else if (t.closest('#st-next')) go(stage + 1);
    else if (t.closest('#st-reveal')) { revealed = true; draw(); }
  });
  $('#st-predict', root)!.addEventListener('change', (e) => { predict = (e.target as HTMLInputElement).checked; revealed = false; draw(); });
  draw();
}

export const visualWidgets: Record<string, (host: HTMLElement) => void> = {
  replication,
  sharding,
  'message-queue': messageQueue,
  dns,
  cdn: cdnVisual,
  'tcp-udp': transport,
  'load-curve': loadCurve,
  'scale-story': scaleStory,
};
