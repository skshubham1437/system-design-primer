import { describe, expect, it } from 'vitest';
import { createCap, capWrite, capRead, capSetPartition, type CapState } from '../../src/lib/cap';

const w = (s: CapState, i: number) => capWrite(s, i).state;
const cut = (s: CapState) => capSetPartition(s, true).state;

describe('CAP lab model', () => {
  it('replicates to every node while the network is healthy', () => {
    const s = w(createCap('cp'), 0);
    expect(s.nodes.map((n) => n.value)).toEqual(['v1', 'v1', 'v1']);
  });

  it('CP: the isolated node refuses reads and writes; the majority keeps working', () => {
    let s = cut(w(createCap('cp'), 0));
    const rejected = capWrite(s, 2);
    expect(rejected.event.kind).toBe('bad');
    expect(rejected.state.writes).toBe(s.writes); // nothing was stored
    expect(capRead(s, 2).kind).toBe('bad');
    s = w(s, 0);
    expect(s.nodes.map((n) => n.value)).toEqual(['v2', 'v2', 'v1']);
    s = capSetPartition(s, false).state;
    expect(s.nodes.every((n) => n.value === 'v2')).toBe(true);
  });

  it('AP: the isolated node answers, with stale data', () => {
    const s = w(cut(w(createCap('ap'), 0)), 0);
    expect(capRead(s, 2).text).toMatch(/STALE/);
  });

  it('AP: writes on both sides conflict and last-write-wins discards the other side\'s value', () => {
    let s = cut(createCap('ap'));
    s = w(s, 2);          // v1 on the isolated side
    s = w(s, 0);          // v2 on the majority side (newer)
    const healed = capSetPartition(s, false);
    expect(healed.lost).toEqual(['v1']);
    expect(healed.state.nodes.every((n) => n.value === 'v2')).toBe(true);
  });

  it('does not count a value overwritten on its own side as lost to the conflict', () => {
    let s = cut(createCap('ap'));
    s = w(s, 0);  // v1 majority side
    s = w(s, 2);  // v2 isolated side
    s = w(s, 0);  // v3 majority side, overwrites v1 there: an ordinary overwrite
    const healed = capSetPartition(s, false);
    expect(healed.lost).toEqual(['v2']);
    expect(healed.event!.text).not.toMatch(/v1/);
  });

  it('reports no loss when only one side wrote', () => {
    let s = cut(createCap('ap'));
    s = w(w(s, 0), 1);
    const healed = capSetPartition(s, false);
    expect(healed.lost).toEqual([]);
    expect(healed.event!.kind).toBe('ok');
  });
});
