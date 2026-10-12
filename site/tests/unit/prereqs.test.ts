import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { validatePrereqs } from '../../scripts/validate/prereqs.mjs';
import { PREREQS } from '../../scripts/site-map.mjs';

const pages = ['a/', 'b/', 'c/'].map((path) => ({ path }));

describe('prerequisite map', () => {
  it('accepts a simple chain', () => {
    expect(validatePrereqs({ pages, prereqs: { 'b/': ['a/'], 'c/': ['b/', 'a/'] } })).toEqual([]);
  });
  it('rejects pages that do not exist, in either position', () => {
    expect(validatePrereqs({ pages, prereqs: { 'b/': ['zzz/'] } }).join()).toMatch(/zzz/);
    expect(validatePrereqs({ pages, prereqs: { 'zzz/': ['a/'] } }).join()).toMatch(/not a page/);
  });
  it('rejects a page that needs itself, a repeat, and a loop', () => {
    expect(validatePrereqs({ pages, prereqs: { 'a/': ['a/'] } }).join()).toMatch(/itself/);
    expect(validatePrereqs({ pages, prereqs: { 'b/': ['a/', 'a/'] } }).join()).toMatch(/twice/);
    expect(validatePrereqs({ pages, prereqs: { 'a/': ['b/'], 'b/': ['c/'], 'c/': ['a/'] } }).join()).toMatch(/loop/);
  });
  it('the real map has no loops (every page in it is checked at build time)', () => {
    const all = new Set<string>([...Object.keys(PREREQS), ...Object.values(PREREQS as Record<string, string[]>).flat()]);
    expect(validatePrereqs({ pages: [...all].map((path) => ({ path })), prereqs: PREREQS })).toEqual([]);
  });
});
