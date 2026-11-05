import { describe, expect, it } from 'vitest';
import * as repl from '../../src/lib/replication';
import { emptyQueue, run, step, waitTicks, totalWaitTicks, PRESSURE_AT, type QueueParams } from '../../src/lib/queue-sim';
import { simulate } from '../../src/lib/transport';
import { assign, imbalance, load, makeUsers, shardsTouched } from '../../src/lib/sharding';
import { resolve } from '../../src/lib/dns';
import * as cdn from '../../src/lib/cdn';
import { curve, responseMs, serversFor, throughput } from '../../src/lib/load-curve';

describe('replication', () => {
  const ticks = (s: repl.State, n: number) => { for (let i = 0; i < n; i++) s = repl.advance(s); return s; };

  it('async: the client is told success at once, but replicas lag behind by the delay', () => {
    let s = repl.create('async', 2);
    s = repl.write(s);
    expect(s.acked).toBe(1);
    s = ticks(s, 1);
    expect(repl.read(s, 1)).toMatchObject({ ok: true, version: 0, behind: 1 }); // a stale read
    s = ticks(s, 1);
    expect(repl.read(s, 1)).toMatchObject({ version: 1, behind: 0 });
  });

  it('async: a primary crash before replication loses acknowledged writes', () => {
    let s = repl.create('async', 3);
    s = repl.write(s); s = repl.write(s);
    s = repl.crashPrimary(s);
    const { state, lost } = repl.promote(s);
    expect(lost).toBe(2);
    expect(state.nodes.find((n) => n.primary)!.version).toBe(0);
  });

  it('async: writes that had already reached a replica survive a crash', () => {
    let s = repl.create('async', 1);
    s = repl.write(s); s = ticks(s, 1);
    s = repl.write(s);               // v2 is still in flight
    s = repl.crashPrimary(s);
    const { lost, state } = repl.promote(s);
    expect(lost).toBe(1);
    expect(state.nodes.find((n) => n.primary)!.version).toBe(1);
  });

  it('sync: the write is acknowledged only after every replica has it, so a crash loses nothing acknowledged', () => {
    let s = repl.create('sync', 2);
    s = repl.write(s);
    expect(s.acked).toBe(0);                 // not acknowledged yet
    s = repl.crashPrimary(s);                 // crash before the replicas confirm
    expect(repl.promote(s).lost).toBe(0);     // nothing the client was told about is missing
    let t = repl.create('sync', 2);
    t = repl.write(t); t = ticks(t, 2);
    expect(t.acked).toBe(1);
  });

  it('promotes the replica with the most data', () => {
    let s = repl.create('async', 1, 2);
    s = repl.write(s); s = ticks(s, 1);
    s.nodes[2].version = 0;                   // one replica is further behind
    s = repl.crashPrimary(s);
    expect(repl.promote(s).state.nodes.find((n) => n.primary)!.id).toBe(1);
  });

  it('refuses writes when there is no primary and reads from a down node', () => {
    let s = repl.crashPrimary(repl.create());
    s = repl.write(s);
    expect(s.log[0]).toMatch(/no primary/);
    expect(repl.read(s, 0).ok).toBe(false);
  });

  it('a recovered node rejoins as a replica and catches up', () => {
    let s = repl.create('async', 1);
    s = repl.write(s); s = ticks(s, 1);
    s = repl.crashPrimary(s);
    s = repl.promote(s).state;
    s = repl.recover(s, 0); s = ticks(s, 2);
    expect(s.nodes[0].primary).toBe(false);
    expect(s.nodes[0].up).toBe(true);
  });

  it('does not mutate the previous state', () => {
    const a = repl.create();
    repl.write(a);
    expect(a.nodes[0].version).toBe(0);
  });
});

describe('queue simulation', () => {
  const base: QueueParams = { produce: 5, consumers: 1, perConsumer: 2, capacity: 20, backPressure: false };

  it('drops messages when the producer is faster than the consumers and the queue fills', () => {
    const last = run(base, 60).at(-1)!;
    expect(last.dropped).toBeGreaterThan(0);
    expect(last.depth).toBeLessThanOrEqual(base.capacity);
  });

  it('back pressure stops the drops by slowing the producer', () => {
    const last = run({ ...base, backPressure: true }, 60).at(-1)!;
    expect(last.dropped).toBe(0);
    expect(last.throttled).toBeGreaterThan(0);
    expect(last.depth).toBeLessThanOrEqual(base.capacity);
  });

  it('consumers that keep up leave the queue near empty', () => {
    const last = run({ ...base, consumers: 4 }, 60).at(-1)!;
    expect(last.depth).toBe(0);
    expect(last.dropped).toBe(0);
  });

  it('handles fractional rates', () => {
    const last = run({ ...base, produce: 2.5, consumers: 1, perConsumer: 2.5 }, 40).at(-1)!;
    expect(last.produced).toBeGreaterThanOrEqual(95);
    expect(last.produced).toBeLessThanOrEqual(100);
  });

  it('never loses or invents messages', () => {
    for (const bp of [false, true]) {
      const f = run({ ...base, backPressure: bp }, 80).at(-1)!;
      expect(f.produced - f.consumed).toBe(f.depth);
    }
  });

  it('back pressure only engages above the threshold', () => {
    const p = { ...base, backPressure: true };
    const calm = step({ ...emptyQueue(), depth: Math.floor(PRESSURE_AT * p.capacity) - 2 }, p);
    expect(calm.throttled).toBe(0);
    const busy = step({ ...emptyQueue(), depth: Math.ceil(PRESSURE_AT * p.capacity) }, p);
    expect(busy.throttled).toBeGreaterThan(0);
  });

  it('accounts for every message created: in the queue, consumed, dropped or waiting at the producer', () => {
    for (const bp of [false, true]) {
      const f = run({ ...base, backPressure: bp }, 80).at(-1)!;
      expect(f.created).toBe(f.produced + f.dropped + f.backlog);
      if (!bp) expect(f.backlog).toBe(0);
    }
  });

  it('back pressure moves the waiting upstream: a permanently faster producer builds an ever-growing backlog', () => {
    const p = { ...base, backPressure: true };
    const frames = run(p, 120);
    expect(frames[120].backlog).toBeGreaterThan(frames[60].backlog);
    expect(frames[120].dropped).toBe(0);
    expect(totalWaitTicks(frames[120], p)).toBeGreaterThan(waitTicks(frames[120].depth, p));
  });

  it('a burst under back pressure drains once the producer slows down', () => {
    const p = { ...base, backPressure: true };
    let s = run(p, 30).at(-1)!;
    expect(s.backlog).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++) s = step(s, { ...p, produce: 1 });
    expect(s.backlog).toBe(0);
    expect(s.dropped).toBe(0);
  });

  it('estimates the wait behind queued messages', () => {
    expect(waitTicks(20, base)).toBe(10);
    expect(waitTicks(5, { ...base, consumers: 0 })).toBe(Infinity);
  });
});

describe('TCP and UDP', () => {
  it('with no loss both deliver everything; TCP just pays for the handshake', () => {
    const t = simulate('tcp', 12, 0, 80), u = simulate('udp', 12, 0, 80);
    expect(t.delivered).toBe(12); expect(u.delivered).toBe(12);
    expect(t.retransmits).toBe(0);
    expect(t.handshakeMs).toBe(80); // one round trip before data can be sent
    expect(u.handshakeMs).toBe(0);
    expect(t.doneAt).toBeGreaterThan(u.doneAt);
  });

  it('under loss UDP leaves gaps while TCP delivers every packet', () => {
    const u = simulate('udp', 40, 20, 80), t = simulate('tcp', 40, 20, 80);
    expect(u.delivered).toBeLessThan(40);
    expect(t.delivered).toBe(40);
    expect(t.retransmits).toBeGreaterThan(0);
  });

  it('TCP hands data to the application strictly in order', () => {
    const t = simulate('tcp', 40, 25, 80);
    for (let i = 1; i < t.packets.length; i++) expect(t.packets[i].deliveredAt!).toBeGreaterThanOrEqual(t.packets[i - 1].deliveredAt!);
  });

  it('head-of-line blocking: later packets wait for a retransmitted earlier one', () => {
    const t = simulate('tcp', 40, 25, 80);
    expect(t.maxStallMs).toBeGreaterThan(0);
  });

  it('TCP takes longer as loss rises, and UDP finishes at the same time regardless', () => {
    expect(simulate('tcp', 30, 30, 80).doneAt).toBeGreaterThan(simulate('tcp', 30, 0, 80).doneAt);
    expect(simulate('udp', 30, 30, 80).doneAt).toBeLessThanOrEqual(simulate('udp', 30, 0, 80).doneAt);
  });

  it('is repeatable for a seed', () => {
    expect(simulate('tcp', 20, 15, 60, 9)).toEqual(simulate('tcp', 20, 15, 60, 9));
  });
});

describe('sharding', () => {
  const users = makeUsers();

  it('hash sharding spreads user counts almost evenly', () => {
    const { count } = load(users, assign('hash', users, 4), 4);
    expect(Math.max(...count) / Math.min(...count)).toBeLessThan(1.5);
  });

  it('range sharding by surname initial leaves some shards far smaller than others', () => {
    const { count } = load(users, assign('range', users, 6), 6);
    expect(Math.max(...count) / Math.min(...count)).toBeGreaterThan(3); // the V-Z shard is nearly empty
  });

  it('even user counts can still hide uneven traffic when a few users are very busy; a directory fixes that', () => {
    const traffic = (s: 'hash' | 'directory') => imbalance(load(users, assign(s, users, 6), 6).traffic);
    expect(traffic('hash')).toBeGreaterThan(1.2);
    expect(traffic('directory')).toBeLessThan(1.05);
  });

  it('every user lands on a valid shard, for any strategy and shard count', () => {
    for (const s of ['range', 'hash', 'directory'] as const) for (const n of [2, 3, 4, 8]) {
      const a = assign(s, users, n);
      expect(a).toHaveLength(users.length);
      expect(a.every((x) => x >= 0 && x < n)).toBe(true);
    }
  });

  it('only range sharding answers a name-prefix query from a single shard; city queries hit every shard', () => {
    expect(shardsTouched('name-prefix', 'range', 4)).toBe(1);
    expect(shardsTouched('name-prefix', 'hash', 4)).toBe(4);
    expect(shardsTouched('by-key', 'hash', 4)).toBe(1);
    expect(shardsTouched('by-city', 'range', 4)).toBe(4);
  });

  it('is deterministic', () => {
    expect(makeUsers()).toEqual(makeUsers());
  });
});

describe('DNS', () => {
  const none = { browserCache: false, osCache: false, resolverCache: false, knowsTld: false };
  const asked = (o: Partial<typeof none>) => resolve({ ...none, ...o }).steps.filter((s) => s.asked).map((s) => s.id);

  it('a cold lookup walks the whole hierarchy', () => {
    const r = resolve(none);
    expect(asked({})).toEqual(['browser', 'os', 'resolver', 'root', 'tld', 'auth']);
    expect(r.answeredBy).toBe('the authoritative server');
    expect(r.totalMs).toBe(0 + 1 + 20 + 30 + 25 + 35);
  });

  it('each cache short-circuits everything after it', () => {
    expect(asked({ browserCache: true })).toEqual(['browser']);
    expect(asked({ osCache: true })).toEqual(['browser', 'os']);
    expect(asked({ resolverCache: true })).toEqual(['browser', 'os', 'resolver']);
  });

  it('a resolver that knows the TLD servers skips the root', () => {
    expect(asked({ knowsTld: true })).toEqual(['browser', 'os', 'resolver', 'tld', 'auth']);
    expect(resolve({ ...none, knowsTld: true }).totalMs).toBe(resolve(none).totalMs - 30);
  });

  it('the earlier the cache, the faster the answer', () => {
    const t = (o: Partial<typeof none>) => resolve({ ...none, ...o }).totalMs;
    expect(t({ browserCache: true })).toBeLessThan(t({ osCache: true }));
    expect(t({ osCache: true })).toBeLessThan(t({ resolverCache: true }));
    expect(t({ resolverCache: true })).toBeLessThan(t({}));
  });
});

describe('CDN', () => {
  it('without a CDN every request pays the trip to the origin', () => {
    const s = cdn.create('none');
    expect(cdn.request(s, 'asia').ms).toBe(cdn.ORIGIN_MS.asia);
    expect(cdn.request(s, 'asia').by).toBe('origin');
  });

  it('pull: the first request is slow and fills the edge, the second is fast', () => {
    let s = cdn.create('pull', 5);
    const first = cdn.request(s, 'eu'); s = first.state;
    expect(first.by).toBe('origin');
    expect(first.ms).toBe(cdn.EDGE_MS + cdn.ORIGIN_MS.eu);
    const second = cdn.request(s, 'eu');
    expect(second).toMatchObject({ by: 'edge', ms: cdn.EDGE_MS });
  });

  it('pull: edges are independent, so another region still misses', () => {
    let s = cdn.create('pull');
    s = cdn.request(s, 'eu').state;
    expect(cdn.request(s, 'asia').by).toBe('origin');
  });

  it('pull: a copy expires after its TTL and is fetched again', () => {
    let s = cdn.create('pull', 3);
    s = cdn.request(s, 'us').state;
    s = cdn.advance(s, 2);
    expect(cdn.request(s, 'us').by).toBe('edge');
    s = cdn.advance(s, 1);
    const r = cdn.request(s, 'us');
    expect(r.by).toBe('origin');
    expect(r.reason).toMatch(/expired/);
  });

  it('push: every edge is warm from the start and never expires', () => {
    let s = cdn.create('push', 1);
    s = cdn.advance(s, 100);
    for (const r of cdn.REGIONS) expect(cdn.request(s, r).by).toBe('edge');
  });

  it('purging empties the edges, so the next request misses (even for push)', () => {
    const s = cdn.purge(cdn.create('push'));
    expect(cdn.request(s, 'eu').by).toBe('origin');
  });

  it('being far from the origin is where an edge helps most', () => {
    const saved = (r: cdn.Region) => cdn.ORIGIN_MS[r] - cdn.EDGE_MS;
    expect(saved('asia')).toBeGreaterThan(saved('eu'));
    expect(saved('eu')).toBeGreaterThan(saved('us'));
  });
});

describe('load curve', () => {
  it('response time rises with utilisation and is just the service time when idle', () => {
    expect(responseMs(0, 20)).toBe(20);
    expect(responseMs(0.5, 20)).toBeCloseTo(40);
    expect(responseMs(0.9, 20)).toBeCloseTo(200);
  });

  it('the last stretch is far worse than the first', () => {
    expect(responseMs(0.95, 10) - responseMs(0.9, 10)).toBeGreaterThan(responseMs(0.5, 10) - responseMs(0, 10));
  });

  it('is capped instead of dividing by zero at full load', () => {
    expect(Number.isFinite(responseMs(1, 10))).toBe(true);
    expect(Number.isFinite(responseMs(5, 10))).toBe(true);
  });

  it('throughput grows with utilisation but cannot exceed capacity', () => {
    expect(throughput(0.5, 100)).toBe(50);
    expect(throughput(2, 100)).toBe(100);
  });

  it('plans servers so each stays at or under the target utilisation', () => {
    expect(serversFor(700, 100, 0.7)).toBe(10);
    expect(serversFor(1, 100)).toBe(1);
  });

  it('produces a monotonic curve', () => {
    const c = curve(10);
    for (let i = 1; i < c.length; i++) expect(c[i].ms).toBeGreaterThan(c[i - 1].ms);
  });
});

describe('semi-synchronous replication', async () => {
  const repl = await import('../../src/lib/replication');
  const ticks = (s: ReturnType<typeof repl.create>, n: number) => { for (let i = 0; i < n; i++) s = repl.advance(s); return s; };
  it('acknowledges once one replica has the write: sooner than sync when a replica is far away', () => {
    let semi = repl.write({ ...repl.create('semi', 2), far: true });
    let sync = repl.write({ ...repl.create('sync', 2), far: true });
    semi = ticks(semi, 2); sync = ticks(sync, 2);
    expect(semi.acked).toBe(1);
    expect(sync.acked).toBe(0);
    sync = ticks(sync, 2);
    expect(sync.acked).toBe(1);
  });
  it('loses nothing acknowledged when the primary crashes, because the closest replica has every acknowledged write', () => {
    let s = repl.write({ ...repl.create('semi', 2), far: true });
    s = ticks(s, 2);
    s = repl.crashPrimary(s);
    const { lost } = repl.promote(s);
    expect(lost).toBe(0);
  });
});

describe('shared queue (M/M/c)', async () => {
  const { responseMs, responseMsShared } = await import('../../src/lib/load-curve');
  it('with one server it is the same as M/M/1', () => {
    for (const u of [0.1, 0.5, 0.9]) expect(responseMsShared(u, 1, 20)).toBeCloseTo(responseMs(u, 20), 6);
  });
  it('a shared queue beats separate queues at the same utilisation, more so with more servers', () => {
    expect(responseMsShared(0.75, 8, 20)).toBeLessThan(responseMs(0.75, 20));
    expect(responseMsShared(0.9, 16, 20)).toBeLessThan(responseMsShared(0.9, 2, 20));
  });
  it('is close to the bare service time when servers are idle', () => {
    expect(responseMsShared(0.05, 8, 20)).toBeCloseTo(20, 1);
  });
});

describe('sharding after traffic changes', async () => {
  const { makeUsers, assign, load, imbalance, laterTraffic } = await import('../../src/lib/sharding');
  const users = makeUsers(600, true);
  it('a lookup table placed by yesterday\'s traffic is no longer balanced when popularity moves', () => {
    const a = assign('directory', users, 4);
    expect(imbalance(load(users, a, 4).traffic)).toBeCloseTo(1, 2);
    expect(imbalance(load(laterTraffic(users, { shift: true }), a, 4).traffic)).toBeGreaterThan(1.05);
  });
  it('one celebrity overloads a shard whatever the strategy', () => {
    for (const s of ['range', 'hash', 'directory'] as const) {
      const a = assign(s, users, 4);
      expect(imbalance(load(laterTraffic(users, { celebrity: true }), a, 4).traffic), s).toBeGreaterThan(1.5);
    }
  });
});

describe('QUIC', async () => {
  const { simulate } = await import('../../src/lib/transport');
  it('is reliable like TCP, but a loss stalls only its own stream, so data reaches the application sooner', () => {
    const t = simulate('tcp', 40, 20, 80), q = simulate('quic', 40, 20, 80);
    expect(q.delivered).toBe(40);
    expect(q.retransmits).toBe(t.retransmits); // the same packets were lost and resent
    const waiting = (r: typeof t) => r.packets.reduce((n, p) => n + (p.deliveredAt! - p.arrivedAt!), 0);
    expect(waiting(q)).toBeLessThan(waiting(t));
  });
});
