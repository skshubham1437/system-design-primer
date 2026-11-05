// The SQL playground: a real PostgreSQL (PGlite) in a worker, loaded only when the learner asks for it.
import { startEngine, stopEngine, engineStarted, type Engine } from '../db/engine';
import { resultHtml, planTextHtml, errorHtml, oneStatement, hasSeveralStatements, esc } from '../db/render';

const DEFAULT_SQL = `-- How are orders spread across statuses?
select status, count(*) as orders
from orders
group by status
order by orders desc;`;

const SAMPLES: { label: string; sql: string }[] = [
  { label: 'Orders by status', sql: DEFAULT_SQL },
  { label: 'One user\'s orders', sql: 'select id, status, created_at, total\nfrom orders\nwhere user_id = 42\norder by created_at desc;' },
  { label: 'Biggest customers', sql: 'select u.id, u.email, count(*) as orders, sum(o.total) as spent\nfrom users u\njoin orders o on o.user_id = u.id\ngroup by u.id, u.email\norder by spent desc\nlimit 10;' },
  { label: 'Add an index', sql: 'create index orders_user_id_idx on orders (user_id);\n-- now try "One user\'s orders" again with Explain analyze' },
  { label: 'Tables and sizes', sql: "select relname as table_name, n_live_tup as rows, pg_size_pretty(pg_total_relation_size(relid)) as size\nfrom pg_stat_user_tables\norder by pg_total_relation_size(relid) desc;" },
];

export function mount(host: HTMLElement) {
  const root = document.createElement('section');
  root.className = 'widget sqlp';
  root.setAttribute('aria-label', 'SQL playground');
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('sql');
  root.innerHTML = `
    <div class="widget-head"><div>
      <p class="eyebrow">Playground</p><h3>Run SQL on a real PostgreSQL</h3>
      <p>Queries run in your browser against the sample shop. Nothing is sent anywhere, and Reset puts every row back.</p>
    </div></div>
    <div class="sqlp-start" id="sqlp-start">
      <p>Starting the database downloads the engine (about 5.6 MB, once) and then builds the sample data, which takes a few seconds.</p>
      <button type="button" class="btn primary" id="sqlp-go">Start the database</button>
    </div>
    <div class="sqlp-body" id="sqlp-body" hidden>
      <div class="sqlp-samples" role="group" aria-label="Example queries">${SAMPLES.map((s, i) => `<button type="button" class="chip-btn" data-sample="${i}">${esc(s.label)}</button>`).join('')}</div>
      <label class="sqlp-label" for="sqlp-sql">SQL <small>Ctrl+Enter runs it</small></label>
      <textarea id="sqlp-sql" class="sqlp-sql" spellcheck="false" autocomplete="off" autocapitalize="off" rows="8"></textarea>
      <div class="sqlp-actions">
        <button type="button" class="btn primary" data-do="run">Run</button>
        <button type="button" class="btn" data-do="explain">Explain</button>
        <button type="button" class="btn" data-do="analyze">Explain analyze</button>
        <button type="button" class="chip-btn" data-do="stop">Stop</button>
        <button type="button" class="chip-btn" data-do="reset">Reset the database</button>
      </div>
    </div>
    <p class="sqlp-status" id="sqlp-status" role="status" aria-live="polite"></p>
    <div class="sqlp-out" id="sqlp-out"></div>`;
  host.replaceChildren(root);

  const $ = (s: string) => root.querySelector<HTMLElement>(s)!;
  const sqlBox = $('#sqlp-sql') as HTMLTextAreaElement;
  sqlBox.value = fromHash ?? DEFAULT_SQL;
  const status = (msg: string) => { $('#sqlp-status').textContent = msg; };
  const out = (html: string) => { $('#sqlp-out').innerHTML = html; };
  let busy = false;
  let engine: Engine | null = null;

  const boot = async () => {
    $('#sqlp-start').hidden = true;
    $('#sqlp-body').hidden = false;
    const t = performance.now();
    status('Starting the database and loading the sample data…');
    root.setAttribute('aria-busy', 'true');
    try {
      engine = await startEngine();
      status(`Ready: ${engine.version}, started in ${((performance.now() - t) / 1000).toFixed(1)} s. 20,000 users, 2,000 products, 100,000 orders.`);
    } catch (e) {
      status('The database could not start.');
      out(errorHtml(e));
    } finally { root.removeAttribute('aria-busy'); }
  };

  const run = async (mode: 'run' | 'explain' | 'analyze') => {
    if (busy) return;
    const sql = sqlBox.value;
    if (!sql.trim()) { status('Type a query first.'); return; }
    if (mode !== 'run' && hasSeveralStatements(sql)) { status('Explain works on one statement at a time. Keep just the query you want to explain.'); return; }
    busy = true;
    root.setAttribute('aria-busy', 'true');
    if (!engineStarted()) { status('Starting a fresh database…'); }
    try {
      engine = await startEngine();
      status(mode === 'run' ? 'Running…' : 'Planning…');
      const t = performance.now();
      if (mode === 'run') {
        const results = await engine.exec(sql);
        const last = results[results.length - 1];
        const ms = performance.now() - t;
        out(last ? resultHtml(last) : '<p class="db-none">Nothing to run.</p>');
        status(`${results.length > 1 ? `${results.length} statements ran. Showing the last result. ` : ''}${last?.fields?.length ? `${last.rows.length.toLocaleString('en-US')} row${last.rows.length === 1 ? '' : 's'}` : 'Done'} in ${Math.round(ms)} ms.`);
      } else {
        const prefix = mode === 'analyze' ? 'explain (analyze, buffers) ' : 'explain ';
        const r = await engine.query(prefix + oneStatement(sql));
        out(planTextHtml(r.rows.map((x) => String(x['QUERY PLAN']))));
        status(mode === 'analyze' ? 'The plan, executed: real row counts and timings. Read it from the most indented line outwards.' : 'The plan the database would use, without running the query. Costs are estimates in arbitrary units.');
      }
    } catch (e) {
      out(errorHtml(e));
      status('The statement failed.');
    } finally {
      busy = false;
      root.removeAttribute('aria-busy');
    }
  };

  $('#sqlp-go').addEventListener('click', boot);
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const sample = t.closest<HTMLElement>('[data-sample]');
    const act = t.closest<HTMLElement>('[data-do]')?.dataset.do;
    if (sample) { sqlBox.value = SAMPLES[Number(sample.dataset.sample)].sql; sqlBox.focus(); return; }
    if (act === 'run' || act === 'explain') void run(act);
    else if (act === 'analyze') void run('analyze');
    else if (act === 'stop') { stopEngine(); busy = false; root.removeAttribute('aria-busy'); status('Stopped. The database was discarded and will be rebuilt the next time you run something.'); }
    else if (act === 'reset') { stopEngine(); busy = false; out(''); void boot(); }
  });
  sqlBox.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void run('run'); } });
  if (fromHash) void boot(); // arriving from an "open in the playground" link: start straight away
}
