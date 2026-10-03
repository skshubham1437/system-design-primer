import type { APIContext } from 'astro';
import { withBase } from '../lib/site';

export function GET({ site }: APIContext) {
  const lines = ['User-agent: *', 'Allow: /'];
  if (site) lines.push('', `Sitemap: ${new URL(withBase('sitemap-index.xml'), site).href}`);
  return new Response(lines.join('\n') + '\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
