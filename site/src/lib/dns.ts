// A DNS lookup, step by step, with the caches that let most lookups skip most of the walk.

export interface DnsOptions {
  browserCache: boolean;   // the browser already knows the answer
  osCache: boolean;        // the operating system already knows it
  resolverCache: boolean;  // the ISP or public resolver already knows it
  knowsTld: boolean;       // the resolver already knows where the .com servers are (skips the root)
}
export interface DnsStep { id: string; label: string; ms: number; asked: boolean; note: string }
export interface DnsResult { steps: DnsStep[]; totalMs: number; answeredBy: string }

export const LATENCY = { browser: 0, os: 1, resolver: 20, root: 30, tld: 25, authoritative: 35 } as const;

export function resolve(o: DnsOptions): DnsResult {
  const steps: DnsStep[] = [];
  const step = (id: string, label: string, ms: number, asked: boolean, note: string) => steps.push({ id, label, ms: asked ? ms : 0, asked, note });
  let answered = '';
  const open = () => answered === '';

  step('browser', 'Browser cache', LATENCY.browser, true, o.browserCache ? 'Found it. No network needed.' : 'Not cached.');
  if (o.browserCache) answered = 'the browser cache';

  const askOs = open();
  step('os', 'Operating system cache', LATENCY.os, askOs, askOs ? (o.osCache ? 'Found it.' : 'Not cached.') : 'Skipped: already answered.');
  if (askOs && o.osCache) answered = 'the OS cache';

  const askResolver = open();
  step('resolver', 'Recursive resolver (your ISP or a public DNS)', LATENCY.resolver, askResolver, askResolver ? (o.resolverCache ? 'It had the answer cached.' : 'Not cached, so it starts walking the hierarchy.') : 'Skipped: already answered.');
  if (askResolver && o.resolverCache) answered = 'the resolver cache';

  const walking = open();
  step('root', 'Root server', LATENCY.root, walking && !o.knowsTld, walking ? (o.knowsTld ? 'Skipped: the resolver already knows the .com servers.' : 'Points to the .com servers.') : 'Skipped: already answered.');
  step('tld', 'TLD server (.com)', LATENCY.tld, walking, walking ? 'Points to the name servers of the domain itself.' : 'Skipped: already answered.');
  step('auth', 'Authoritative server', LATENCY.authoritative, walking, walking ? 'Returns the IP address. The answer is cached for its TTL.' : 'Skipped: already answered.');
  if (walking) answered = 'the authoritative server';

  return { steps, totalMs: steps.reduce((n, s) => n + s.ms, 0), answeredBy: answered };
}
