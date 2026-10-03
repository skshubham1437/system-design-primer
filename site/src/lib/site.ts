import data from '../generated/site.json';

export interface TocItem { id: string; text: string; depth: number }
export interface Page {
  kind: 'topic' | 'about' | 'solution' | 'ood';
  section: string;
  slug: string;
  group: string;
  path: string; // "learn/cache/"
  title: string;
  short?: string;
  blurb: string;
  html: string;
  toc: TocItem[];
  minutes: number;
  difficulty?: string;
  thumb?: string;
  concepts?: string[];
}
export interface Group { id: string; label: string }

export const BASE: string = data.base;
export const REPO: string = data.repo;
export const groups = data.groups as Group[];
export const pages = data.pages as Page[];

export const withBase = (p: string) => BASE + p.replace(/^\//, '');
export const pageByPath = (p: string) => pages.find((x) => x.path === p);
export const href = (p: Page) => withBase(p.path);

const topicPages = pages.filter((p) => p.kind === 'topic');
export const solutions = pages.filter((p) => p.kind === 'solution');
export const oodPages = pages.filter((p) => p.kind === 'ood');

export const pagesInGroup = (id: string) => topicPages.filter((p) => p.group === id);

// Reading order: groups in order, topics inside each group.
export const trail: Page[] = groups.flatMap((g) => pagesInGroup(g.id));

export function neighbours(page: Page): { prev?: Page; next?: Page } {
  const list = page.kind === 'solution' ? solutions : page.kind === 'ood' ? oodPages : trail;
  const i = list.findIndex((p) => p.path === page.path);
  if (i < 0) return {};
  return { prev: list[i - 1], next: list[i + 1] };
}

export const groupLabel = (id: string) => groups.find((g) => g.id === id)?.label ?? '';

// Where the page's markdown lives upstream, for "Edit on GitHub".
export function sourceUrl(page: Page): string {
  if (page.kind === 'solution') return `${REPO}/blob/master/solutions/system_design/${page.slug.replace(/-/g, '_')}/README.md`;
  if (page.kind === 'ood') return `${REPO}/tree/master/solutions/object_oriented_design/${page.slug.replace(/-/g, '_')}`;
  return `${REPO}/blob/master/README.md`;
}

export const stats = {
  topics: pages.filter((p) => p.kind === 'topic' && (p.section === 'learn')).length,
  solutions: solutions.length,
  ood: oodPages.length,
};
