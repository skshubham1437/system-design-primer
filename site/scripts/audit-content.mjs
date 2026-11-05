// Content audit. Reads the generated site data and reports, per page: length, structure, media,
// links, and (with --links) whether every external link still answers.
//
//   node scripts/audit-content.mjs                 structure report only (fast)
//   node scripts/audit-content.mjs --links         also check external links (slow, needs network)
//   node scripts/audit-content.mjs --json out.json write the raw results
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'generated', 'site.json'), 'utf8'));
const args = process.argv.slice(2);
const checkLinks = args.includes('--links');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

const text = (html) => html.replace(/<pre[\s\S]*?<\/pre>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ').trim();
const count = (html, re) => (html.match(re) || []).length;

const pages = site.pages.map((p) => {
  const words = text(p.html).split(' ').filter(Boolean).length;
  const externals = [...p.html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]).filter((u) => !u.includes('github.com/skshubham1437'));
  return {
    path: p.path, title: p.title, kind: p.kind, original: !!p.original,
    words, minutes: p.minutes,
    headings: count(p.html, /<h[2-6][\s>]/g),
    images: count(p.html, /<img /g),
    tables: count(p.html, /<table/g),
    code: count(p.html, /class="code-block/g),
    callouts: count(p.html, /callout-tradeoff/g),
    sources: count(p.html, /<details class="sources"/g),
    externals,
  };
});

const unique = [...new Set(pages.flatMap((p) => p.externals))];
const status = {};

async function probe(url) {
  const tryOnce = async (method) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 15000);
    try {
      const r = await fetch(url, { method, redirect: 'follow', signal: c.signal, headers: { 'user-agent': 'Mozilla/5.0 (primer-audit)' } });
      return r.status;
    } catch (e) { return e.name === 'AbortError' ? 'timeout' : 'error'; }
    finally { clearTimeout(t); }
  };
  let s = await tryOnce('HEAD');
  if (typeof s !== 'number' || s >= 400) s = await tryOnce('GET'); // many servers reject HEAD
  return s;
}

if (checkLinks) {
  let i = 0;
  const worker = async () => { while (i < unique.length) { const u = unique[i++]; status[u] = await probe(u); } };
  await Promise.all(Array.from({ length: 12 }, worker));
}

const classify = (s) => (typeof s === 'number' ? (s < 400 ? 'ok' : s === 403 || s === 429 || s === 999 ? 'blocked' : 'dead') : 'dead');
const summary = { pages: pages.length, uniqueExternal: unique.length };
if (checkLinks) {
  const buckets = { ok: 0, blocked: 0, dead: 0 };
  for (const u of unique) buckets[classify(status[u])]++;
  Object.assign(summary, buckets);
}

if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ summary, pages, status }, null, 2));

console.log(JSON.stringify(summary));
console.log('\nFewest words first (thin pages are candidates for expansion):');
for (const p of [...pages].filter((x) => x.kind === 'topic' && !x.original).sort((a, b) => a.words - b.words).slice(0, 12)) {
  console.log(`  ${String(p.words).padStart(5)} words  ${String(p.images).padStart(2)} img  ${String(p.code).padStart(2)} code  ${p.path}`);
}
if (checkLinks) {
  console.log('\nDead external links by page:');
  for (const p of pages) {
    const dead = [...new Set(p.externals)].filter((u) => classify(status[u]) === 'dead');
    if (dead.length) console.log(`  ${String(dead.length).padStart(3)} / ${String(new Set(p.externals).size).padStart(3)}  ${p.path}`);
  }
}
