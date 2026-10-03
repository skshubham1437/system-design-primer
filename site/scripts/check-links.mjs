// Verifies that every internal link / asset referenced by the built site exists in dist/.
import fs from 'node:fs';
import path from 'node:path';
const dist = path.resolve('dist');
const base = (process.env.SITE_BASE || '/').replace(/\/?$/, '/');
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); f.isDirectory() ? walk(p) : p.endsWith('.html') && files.push(p); } })(dist);
const exists = (u) => {
  let rel = decodeURIComponent(u.slice(base.length)).replace(/[?#].*$/, '');
  const p = path.join(dist, rel);
  return fs.existsSync(p) && (fs.statSync(p).isFile() || fs.existsSync(path.join(p, 'index.html')));
};
const ids = new Map();
const idsOf = (f) => ids.get(f) ?? ids.set(f, new Set([...fs.readFileSync(f, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))).get(f);
const resolveFile = (u) => { const rel = u.slice(base.length).replace(/[?#].*$/, ''); const p = path.join(dist, rel); return fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p; };
let bad = 0, checked = 0;
for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const u = m[1];
    if (/^(https?:|mailto:|data:|javascript:)/.test(u)) continue;
    checked++;
    if (u.startsWith('#')) { if (!idsOf(f).has(u.slice(1))) { bad++; console.log(`${path.relative(dist, f)}: missing local anchor ${u}`); } continue; }
    if (!u.startsWith(base)) { bad++; console.log(`${path.relative(dist, f)}: unexpected URL ${u}`); continue; }
    if (!exists(u)) { bad++; console.log(`${path.relative(dist, f)}: broken ${u}`); continue; }
    const hash = u.split('#')[1];
    if (/study-guide\/#(short|medium|long)$/.test(u)) continue; // handled by the planner widget
    if (hash && resolveFile(u).endsWith('.html') && !idsOf(resolveFile(u)).has(hash)) { bad++; console.log(`${path.relative(dist, f)}: missing anchor ${u}`); }
  }
}
console.log(`${checked} internal references checked, ${bad} problem(s)`);
process.exit(bad ? 1 : 0);
