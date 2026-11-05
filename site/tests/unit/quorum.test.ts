import { describe, expect, it } from 'vitest';
import { createQuorum, quorumWrite, quorumRead, quorumSync, toggleReplica, overlaps, tolerates } from '../../src/lib/quorum';

describe('quorum reads and writes', () => {
  it('when R + W > N, a worst-case read right after a write always sees it', () => {
    for (const n of [3, 5]) for (let w = 1; w <= n; w++) for (let r = 1; r <= n; r++) {
      let s = createQuorum(n, w, r);
      for (let k = 0; k < 4; k++) s = quorumWrite(s).state;
      const read = quorumRead(s);
      if (r + w > n) expect(read.stale, `N=${n} W=${w} R=${r}`).toBe(false);
    }
  });

  it('when R + W <= N, a read can miss the latest write', () => {
    const s = quorumWrite(createQuorum(3, 1, 1)).state;
    expect(quorumRead(s).stale).toBe(true);
    expect(overlaps({ n: 3, w: 1, r: 1 })).toBe(false);
  });

  it('a write needs W reachable replicas; with fewer it is refused', () => {
    let s = createQuorum(3, 2, 2);
    s = toggleReplica(toggleReplica(s, 0), 1);
    expect(quorumWrite(s).ok).toBe(false);
    expect(tolerates({ n: 3, w: 2, r: 2 })).toEqual({ writes: 1, reads: 1 });
  });

  it('syncing brings every live replica up to date', () => {
    const s = quorumSync(quorumWrite(createQuorum(3, 1, 1)).state);
    expect(s.versions).toEqual([1, 1, 1]);
  });
});
