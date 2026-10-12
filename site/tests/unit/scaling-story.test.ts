import { describe, expect, it } from 'vitest';
import { architectureAt, newAt, STAGES } from '../../src/lib/scaling-story';

const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('scaling story diagram', () => {
  const stages = Array.from({ length: STAGES }, (_, i) => i + 1);

  it('has nine stages, starting with a single server and ending with several regions', () => {
    expect(STAGES).toBe(9);
    expect(architectureAt(1).components.map((c) => c.id)).toEqual(['users', 'mono']);
    expect(architectureAt(9).components.some((c) => c.id === 'region2')).toBe(true);
  });

  it('boxes never overlap, at any stage', () => {
    for (const s of stages) {
      const { components } = architectureAt(s);
      for (let i = 0; i < components.length; i++) for (let j = i + 1; j < components.length; j++) {
        expect(overlap(components[i], components[j]), `stage ${s}: ${components[i].id} overlaps ${components[j].id}`).toBe(false);
      }
    }
  });

  it('every box fits inside the 800 x 340 canvas', () => {
    for (const s of stages) for (const c of architectureAt(s).components) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w, `${c.id} at stage ${s}`).toBeLessThanOrEqual(800);
      expect(c.y + c.h, `${c.id} at stage ${s}`).toBeLessThanOrEqual(340);
    }
  });

  it('every line joins two boxes that exist at that stage', () => {
    for (const s of stages) {
      const { components, edges } = architectureAt(s);
      const ids = new Set(components.map((c) => c.id));
      for (const e of edges) { expect(ids.has(e.from), `stage ${s}: ${e.from}`).toBe(true); expect(ids.has(e.to), `stage ${s}: ${e.to}`).toBe(true); }
    }
  });

  it('every box ends up connected to something (except the dashed region note)', () => {
    for (const s of stages) {
      const { components, edges } = architectureAt(s);
      for (const c of components.filter((x) => !x.ghost)) {
        if (components.length === 1) continue;
        expect(edges.some((e) => e.from === c.id || e.to === c.id), `stage ${s}: ${c.id} has no line`).toBe(true);
      }
    }
  });

  it('each stage after the first adds something, and the diagram only ever grows (apart from planned replacements)', () => {
    for (const s of stages.slice(1)) expect(newAt(s).length, `stage ${s} adds nothing`).toBeGreaterThan(0);
    expect(architectureAt(9).components.length).toBeGreaterThan(architectureAt(3).components.length);
  });

  it('the stage names the component it introduces', () => {
    expect(newAt(3)).toEqual(expect.arrayContaining(['dns', 'lb']));
    expect(newAt(4)).toEqual(['cache']);
    expect(newAt(6)).toEqual(['cdn']);
    expect(newAt(7)).toEqual(expect.arrayContaining(['queue', 'workers']));
    expect(newAt(8)).toEqual(['shardB']);
  });

  it('the database is split into a primary and replicas at stage 5, then sharded at stage 8', () => {
    const ids = (s: number) => architectureAt(s).components.map((c) => c.id);
    expect(ids(4)).toContain('db');
    expect(ids(5)).not.toContain('db');
    expect(ids(5)).toEqual(expect.arrayContaining(['primary', 'r1', 'r2']));
    expect(architectureAt(8).components.find((c) => c.id === 'primary')!.label).toBe('Shard A');
    expect(architectureAt(7).components.find((c) => c.id === 'primary')!.label).toBe('Primary');
  });

  it('clamps out-of-range stages', () => {
    expect(architectureAt(0)).toEqual(architectureAt(1));
    expect(architectureAt(99)).toEqual(architectureAt(9));
  });
});
