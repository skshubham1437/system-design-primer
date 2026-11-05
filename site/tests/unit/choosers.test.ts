import { describe, expect, it } from 'vitest';
import { validateChoosers } from '../../scripts/validate/choosers.mjs';

const pages = [{ path: 'learn/database/', html: '<h4 id="sharding">x</h4>' }];

const result = (over: Record<string, unknown> = {}) => ({
  title: 'A relational database',
  why: 'Transactions and joins are what relational databases are built for, with mature tooling.',
  tradeoffs: ['Scaling writes needs extra work.', 'The schema needs planning to change.'],
  link: '#sharding',
  ...over,
});
const scenario = (id: string, answer: number) => ({
  id, answer,
  scenario: 'A situation that is described in enough detail to reason about it properly.',
  options: [0, 1, 2].map((n) => ({ label: `Option ${n}`, why: 'An explanation of why this option is right or wrong.' })),
});
const good = () => ({
  id: 'x', title: 'A chooser', reviewed: false, topic: 'learn/database/',
  tree: {
    start: 'a',
    nodes: {
      a: { ask: 'Do you need transactions across records?', options: [{ label: 'Yes', result: 'sql' }, { label: 'No', next: 'b' }] },
      b: { ask: 'Is your data heavily relational overall?', options: [{ label: 'Yes', result: 'sql' }, { label: 'No', result: 'kv' }] },
    },
  },
  results: { sql: result(), kv: result({ title: 'A key-value store' }) },
  scenarios: [scenario('s1', 0), scenario('s2', 1), scenario('s3', 2), scenario('s4', 1), scenario('s5', 0)],
});
const run = (d: unknown, slug = 'x') => validateChoosers({ choosers: [{ slug, file: `content/choosers/${slug}.yaml`, data: d }], pages }).join('\n');

describe('validateChoosers', () => {
  it('accepts a complete chooser', () => {
    expect(run(good())).toBe('');
  });

  it('reports parse errors and empty files', () => {
    expect(validateChoosers({ choosers: [{ slug: 'x', file: 'f', data: null, error: 'bad' }], pages })[0]).toMatch(/could not parse/);
    expect(validateChoosers({ choosers: [{ slug: 'x', file: 'f', data: null }], pages })[0]).toMatch(/empty/);
  });

  it('needs a real topic, matching file name and explicit reviewed flag', () => {
    expect(run({ ...good(), topic: 'learn/nope/' })).toMatch(/not a page/);
    expect(run(good(), 'other')).toMatch(/should match the file name/);
    expect(run({ ...good(), reviewed: 'yes' })).toMatch(/reviewed/);
  });

  it('every option must lead somewhere: exactly one of next or result', () => {
    const d = good(); (d.tree.nodes.a.options[0] as Record<string, unknown>).next = 'b';
    expect(run(d)).toMatch(/exactly one of "next" or "result"/);
    const none = good(); delete (none.tree.nodes.a.options[0] as Record<string, unknown>).result;
    expect(run(none)).toMatch(/exactly one of/);
  });

  it('rejects links to nodes or results that do not exist', () => {
    const d = good(); (d.tree.nodes.a.options[1] as Record<string, unknown>).next = 'ghost';
    expect(run(d)).toMatch(/not a node/);
    const r = good(); (r.tree.nodes.b.options[1] as Record<string, unknown>).result = 'ghost';
    expect(run(r)).toMatch(/not defined/);
  });

  it('rejects a node nobody can reach, and a result nobody is ever sent to', () => {
    const d = good() as any;
    d.tree.nodes.orphan = { ask: 'A question nothing points to at all?', options: [{ label: 'A', result: 'sql' }, { label: 'B', result: 'kv' }] };
    expect(run(d)).toMatch(/node "orphan" can never be reached/);
    const e = good() as any; e.results.unused = result();
    expect(run(e)).toMatch(/result "unused" is never recommended/);
  });

  it('rejects a question tree that loops', () => {
    const d = good() as any;
    d.tree.nodes.b.options[0] = { label: 'Yes', next: 'a' };
    expect(run(d)).toMatch(/loops back/);
  });

  it('requires a start node', () => {
    expect(run({ ...good(), tree: { ...good().tree, start: 'nowhere' } })).toMatch(/tree.start/);
  });

  it('a recommendation must come with its downsides and a real explanation', () => {
    const d = good() as any; d.results.sql = result({ tradeoffs: ['Only one downside here.'] });
    expect(run(d)).toMatch(/2 to 4 trade-offs/);
    const e = good() as any; e.results.sql = result({ why: 'Too short.' });
    expect(run(e)).toMatch(/"why" is missing/);
  });

  it('result links must land on a heading of the topic page', () => {
    const d = good() as any; d.results.sql = result({ link: '#not-there' });
    expect(run(d)).toMatch(/does not match a heading/);
  });

  it('needs 4 to 10 scenarios, a valid answer index, and explanations for every option', () => {
    expect(run({ ...good(), scenarios: good().scenarios.slice(0, 3) })).toMatch(/4 to 10 scenarios/);
    const d = good() as any; d.scenarios[0].answer = 9;
    expect(run(d)).toMatch(/"answer" must be the index/);
    const e = good() as any; e.scenarios[0].options[1].why = 'No.';
    expect(run(e)).toMatch(/explain why/);
  });

  it('flags a scenario set where the best option is always in the same place', () => {
    const d = good() as any; d.scenarios = [0, 0, 0, 0, 1].map((a, i) => scenario(`s${i}`, a));
    expect(run(d)).toMatch(/same position too often/);
  });

  it('scenario ids must be unique', () => {
    const d = good() as any; d.scenarios[1].id = d.scenarios[0].id;
    expect(run(d)).toMatch(/unique lowercase id/);
  });
});
