// Reads the upstream Anki deck (resources/flash_cards/System Design.apkg) so the
// concept cards can be studied in the browser. The deck is a zip holding an SQLite file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeStringify from 'rehype-stringify';
import { visit, SKIP } from 'unist-util-visit';
import { toString as hastToString } from 'hast-util-to-string';

export async function readDeck(file) {
  const { DatabaseSync } = await import('node:sqlite');
  const files = unzipSync(new Uint8Array(fs.readFileSync(file)));
  const db = files['collection.anki2'];
  if (!db) throw new Error('collection.anki2 not found in ' + file);
  const tmp = path.join(os.tmpdir(), `primer-deck-${process.pid}.sqlite`);
  fs.writeFileSync(tmp, db);
  const conn = new DatabaseSync(tmp, { readOnly: true });
  try {
    return conn.prepare('select flds from notes order by id').all().map((r) => {
      const [front, back] = String(r.flds).split('\x1f');
      return { front, back };
    });
  } finally {
    conn.close();
    fs.rmSync(tmp, { force: true });
  }
}

const parseFragment = unified().use(rehypeParse, { fragment: true });
const KEEP_ATTRS = { a: ['href'], img: ['src', 'alt'], td: [], th: [] };

// Strip the inline styling, icons and ids that came with the GitHub copy-paste,
// and route links/images through the site's resolvers.
export function cleanCard(html, { resolveHref, resolveImg }) {
  const tree = parseFragment.parse(html);
  visit(tree, 'element', (node, index, parent) => {
    if (['svg', 'script', 'style'].includes(node.tagName)) { parent.children.splice(index, 1); return [SKIP, index]; }
    const keep = KEEP_ATTRS[node.tagName] ?? [];
    for (const k of Object.keys(node.properties ?? {})) if (!keep.includes(k)) delete node.properties[k];
    if (node.tagName === 'a' && parent && node.children.length === 1 && node.children[0].tagName === 'img') {
      parent.children[index] = node.children[0]; // images were wrapped in links to the GitHub proxy; drop the link
      return index;
    }
    if (node.tagName === 'a') {
      const empty = !hastToString(node).trim() && !node.children.some((c) => c.tagName === 'img');
      if (empty) { parent.children.splice(index, 1); return [SKIP, index]; }
      const r = resolveHref(String(node.properties.href ?? ''));
      node.properties.href = r.href;
      if (r.external) { node.properties.target = '_blank'; node.properties.rel = 'noopener noreferrer'; node.properties.className = ['ext']; }
    }
    if (node.tagName === 'img') {
      if (node.data?.cleaned) return; // revisited after its link wrapper was removed
      node.data = { ...node.data, cleaned: true };
      const info = resolveImg(String(node.properties.src ?? ''));
      if (!info) { parent.children.splice(index, 1); return [SKIP, index]; }
      node.properties.src = info.src;
      node.properties.loading = 'lazy';
      node.properties.alt ||= 'Diagram';
    }
  });
  return unified().use(rehypeStringify).stringify(tree).replace(/<p>\s*<\/p>/g, '');
}

export const cardTitle = (html) => hastToString(parseFragment.parse(html)).replace(/\s+/g, ' ').trim();
