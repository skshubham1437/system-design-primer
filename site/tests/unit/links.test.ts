import { describe, expect, it, vi } from 'vitest';
import { createLinkResolver, deckFileName } from '../../scripts/lib/links.mjs';

const REPO = 'https://github.com/donnemartin/system-design-primer';

function make(base = '/') {
  const warn = vi.fn();
  const anchorMap = new Map([
    ['cache', 'learn/cache/'],
    ['cache-aside', 'learn/cache/#cache-aside'],
    ['sharding', 'learn/database/#sharding'],
  ]);
  return { warn, ...createLinkResolver({ base, repo: REPO, anchorMap, warn }) };
}

describe('resolveHref', () => {
  const ctx = { name: 'test', dir: '', localIds: new Set<string>() };

  it('resolves README anchors to the page that now holds the heading', () => {
    const { resolveHref } = make();
    expect(resolveHref('#cache-aside', ctx)).toEqual({ href: '/learn/cache/#cache-aside' });
    expect(resolveHref('#cache', ctx)).toEqual({ href: '/learn/cache/' });
  });

  it('prefers a heading on the same page over the global map', () => {
    const { resolveHref } = make();
    expect(resolveHref('#cache', { ...ctx, localIds: new Set(['cache']) })).toEqual({ href: '#cache' });
  });

  it('resolves absolute github.com anchors the same way (used by solutions)', () => {
    const { resolveHref } = make();
    expect(resolveHref(`${REPO}#sharding`, ctx)).toEqual({ href: '/learn/database/#sharding' });
    expect(resolveHref(`${REPO}/#sharding`, ctx)).toEqual({ href: '/learn/database/#sharding' });
  });

  it('ignores stray ">1" suffixes and url-encoding in upstream anchors', () => {
    const { resolveHref } = make();
    expect(resolveHref(`${REPO}#cache%3E1`, ctx)).toEqual({ href: '/learn/cache/' });
  });

  it('honours the base path', () => {
    const { resolveHref } = make('/primer/');
    expect(resolveHref('#cache', ctx)).toEqual({ href: '/primer/learn/cache/' });
  });

  it('warns (fatally) and falls back to GitHub when an anchor is unknown', () => {
    const { resolveHref, warn } = make();
    expect(resolveHref('#nope', ctx)).toEqual({ href: `${REPO}#nope`, external: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('#nope'), true);
  });

  it('maps relative solution links to site routes, including from another solution', () => {
    const { resolveHref } = make();
    const inSolution = { ...ctx, dir: 'solutions/system_design/pastebin' };
    expect(resolveHref('../scaling_aws/README.md', inSolution)).toEqual({ href: '/practice/system-design/scaling-aws/' });
    expect(resolveHref('solutions/system_design/web_crawler/README.md', ctx)).toEqual({ href: '/practice/system-design/web-crawler/' });
  });

  it('maps object-oriented notebooks to their page', () => {
    const { resolveHref } = make();
    expect(resolveHref('solutions/object_oriented_design/lru_cache/lru_cache.ipynb', ctx)).toEqual({ href: '/practice/object-oriented/lru-cache/' });
  });

  it('sends files we do not render to GitHub', () => {
    const { resolveHref } = make();
    expect(resolveHref('CONTRIBUTING.md', ctx)).toEqual({ href: `${REPO}/blob/master/CONTRIBUTING.md`, external: true });
  });

  it('marks outside links external and leaves them untouched', () => {
    const { resolveHref } = make();
    expect(resolveHref('https://example.com/a?b=1', ctx)).toEqual({ href: 'https://example.com/a?b=1', external: true });
    expect(resolveHref('mailto:a@b.co', ctx)).toEqual({ href: 'mailto:a@b.co', external: true });
  });

  it('serves the Anki decks from the site', () => {
    const { resolveHref } = make();
    expect(resolveHref(`${REPO}/tree/master/resources/flash_cards/System%20Design%20Exercises.apkg`, ctx))
      .toEqual({ href: '/downloads/system-design-exercises.apkg', download: true });
  });

  it('passes empty hrefs through', () => {
    const { resolveHref } = make();
    expect(resolveHref('', ctx)).toEqual({ href: '' });
  });
});

describe('deckFileName', () => {
  it('slugifies deck names', () => {
    expect(deckFileName('System Design.apkg')).toBe('system-design.apkg');
    expect(deckFileName('OO Design.apkg')).toBe('oo-design.apkg');
  });
});
