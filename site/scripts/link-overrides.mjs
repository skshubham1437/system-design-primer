// Builds data/link-overrides.json: for every external link the audit found dead, the closest archived copy
// (Internet Archive Wayback Machine) if one exists. The content build rewrites those links, so learners
// land on something readable instead of a 404.
//
//   node scripts/audit-content.mjs --links --json audit.json
//   node scripts/link-overrides.mjs audit.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const auditFile = process.argv[2];
if (!auditFile) { console.error('usage: node scripts/link-overrides.mjs <audit.json>'); process.exit(1); }
const audit = JSON.parse(fs.readFileSync(auditFile, 'utf8'));

const isDead = (s) => !(typeof s === 'number' && (s < 400 || s === 403 || s === 429 || s === 999));
const dead = Object.entries(audit.status).filter(([, s]) => isDead(s)).map(([u]) => u);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ask the Wayback API, backing off when it rate limits us. Returns { snapshot } or { unknown: true }. */
async function lookup(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, { headers: { 'user-agent': 'primer-link-overrides' } });
      if (r.status === 429 || r.status >= 500) { await sleep(8000 * 2 ** attempt); continue; }
      const j = await r.json();
      const s = j?.archived_snapshots?.closest;
      return { snapshot: s?.available && String(s.status).startsWith('2') ? s.url.replace(/^http:/, 'https:') : null };
    } catch { await sleep(4000); }
  }
  return { unknown: true };
}

// Keep earlier results; only ask about links we have no answer for yet.
const file = path.join(here, '..', 'data', 'link-overrides.json');
const out = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
for (const url of Object.keys(out)) if (!dead.includes(url)) delete out[url]; // a link that came back to life needs no override
for (const url of dead) {
  if (out[url]?.checked && out[url].replacement !== undefined && !out[url].unknown) continue;
  const res = await lookup(url);
  await sleep(3000);
  if (res.unknown) { console.log('unknown   ', url, '(rate limited, try again later)'); continue; }
  out[url] = { replacement: res.snapshot, checked: new Date().toISOString().slice(0, 10) };
  console.log(res.snapshot ? 'archived  ' : 'no copy   ', url);
}

fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log(`\nwrote ${Object.keys(out).length} entries to data/link-overrides.json`);
