import { pages, groupLabel } from '../lib/site';

export function GET() {
  const entries = pages.map((p) => ({
    t: p.title,
    p: p.path,
    g: p.kind === 'solution' ? 'Solution' : p.kind === 'ood' ? 'Object-oriented design' : p.kind === 'about' ? 'About' : groupLabel(p.group),
    b: p.blurb,
    h: p.toc.map((h) => ({ id: h.id, text: h.text })),
  }));
  return new Response(JSON.stringify(entries), { headers: { 'content-type': 'application/json' } });
}
