// Turns README.md, solutions/ and the OOD notebooks into page data for the site.
// Output: src/generated/site.json  (+ images copied into public/img)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import GithubSlugger from 'github-slugger';
import { toString as mdToString } from 'mdast-util-to-string';
import { toString as hastToString } from 'hast-util-to-string';
import { visit } from 'unist-util-visit';
import { createHighlighter } from 'shiki';
import { readDeck, cleanCard, cardTitle } from './flashcards.mjs';
import { REPO, GROUPS, PAGES, ABOUT_H2, ANCHOR_OVERRIDES, SKIPPED_H2, SOLUTIONS, OOD, WIDGETS } from './site-map.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(here, '..');
const ROOT = path.resolve(SITE, '..');
const BASE = (process.env.SITE_BASE || '/').replace(/\/?$/, '/');
const OUT = path.join(SITE, 'src', 'generated');
const IMG_LOCAL = path.join(SITE, 'public', 'img', 'local');
const IMG_REMOTE = path.join(SITE, 'public', 'img', 'remote');

const warnings = [];
const warn = (msg) => warnings.push(msg);

// ---------------------------------------------------------------- helpers

const parser = unified().use(remarkParse).use(remarkGfm);
const parse = (md) => parser.parse(md);
const isHeading = (n, depth) => n.type === 'heading' && (depth == null || n.depth === depth);
const slugOf = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function imageSize(buf) {
  try {
    if (buf[0] === 0x89 && buf[1] === 0x50) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch { /* fall through */ }
  return {};
}

// ---------------------------------------------------------------- images

const imgMap = new Map(); // original src -> { src, width, height }

async function prepareImages(sources) {
  fs.mkdirSync(IMG_LOCAL, { recursive: true });
  fs.mkdirSync(IMG_REMOTE, { recursive: true });
  const urls = new Set();
  for (const md of sources) {
    for (const m of md.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) urls.add(m[1]);
    for (const m of md.matchAll(/<img[^>]*\ssrc=["']?([^"'\s>]+)/g)) urls.add(m[1]);
  }
  const remote = [];
  for (const url of urls) {
    if (/^https?:/.test(url)) { remote.push(url); continue; }
    const file = path.join(ROOT, url);
    if (!fs.existsSync(file)) { warn(`missing local image: ${url}`); continue; }
    const name = path.basename(file);
    fs.copyFileSync(file, path.join(IMG_LOCAL, name));
    imgMap.set(url, { src: `${BASE}img/local/${name}`, ...imageSize(fs.readFileSync(file)) });
  }
  const fetchOne = async (url) => {
    // GitHub's camo proxy URLs embed the original URL as hex; fetch the original.
    const camo = url.match(/camo\.githubusercontent\.com\/[0-9a-f]+\/([0-9a-f]+)$/);
    const real = (camo ? Buffer.from(camo[1], 'hex').toString() : url).replace(/^http:/, 'https:');
    const ext = (real.match(/\.(png|jpe?g|gif|svg|webp)(\?|$)/i) || [, 'png'])[1].toLowerCase();
    const name = crypto.createHash('sha1').update(url).digest('hex').slice(0, 10) + '.' + ext;
    const file = path.join(IMG_REMOTE, name);
    // Many remote diagrams are also vendored in images/; prefer that copy.
    const vendored = path.join(ROOT, 'images', path.basename(real.split('?')[0]));
    if (!fs.existsSync(file) && fs.existsSync(vendored)) {
      fs.copyFileSync(vendored, file);
    }
    if (!fs.existsSync(file)) {
      try {
        const res = await fetch(real, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 primer-site-build' } });
        const type = res.headers.get('content-type') || '';
        if (!res.ok || !type.startsWith('image/') || /removed/.test(res.url)) throw new Error(`${res.status} ${type}`);
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      } catch (e) {
        warn(`could not download ${url} (${e.message})`);
        return;
      }
    }
    imgMap.set(url, { src: `${BASE}img/remote/${name}`, ...imageSize(fs.readFileSync(file)) });
  };
  for (let i = 0; i < remote.length; i += 6) await Promise.all(remote.slice(i, i + 6).map(fetchOne));
}

// ---------------------------------------------------------------- README sections

const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').replace(/:\+1:/g, '<span class="yes" role="img" aria-label="Yes">✓</span>');

function readSections(tree) {
  // Assign GitHub-compatible heading ids across the whole README, in order.
  const slugger = new GithubSlugger();
  for (const n of tree.children) if (n.type === 'heading') n.data = { ...n.data, hProperties: { id: slugger.slug(mdToString(n)) } };
  const h2 = [];
  let cur = null;
  for (const n of tree.children) {
    if (isHeading(n, 2)) { cur = { title: mdToString(n), heading: n, nodes: [] }; h2.push(cur); }
    else if (cur) cur.nodes.push(n);
  }
  return h2;
}

const idOf = (h) => h.data.hProperties.id;

// ---------------------------------------------------------------- link + anchor resolution

const anchorMap = new Map(); // heading id -> path ("learn/cache/#sharding")

function internal(p) { return BASE + p; }

function anchorTo(id, ctx) {
  id = decodeURIComponent(id).split('>')[0]; // some upstream links carry stray ">1" suffixes
  if (ctx.localIds?.has(id)) return { href: `#${id}` };
  const target = anchorMap.get(id);
  if (!target) { warn(`unresolved anchor #${id} (in ${ctx.name})`); return { href: `${REPO}#${id}`, external: true }; }
  return { href: internal(target) };
}

// "System Design Exercises.apkg" -> "system-design-exercises.apkg"
const deckFileName = (name) => name.replace(/\.apkg$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.apkg';

function copyDecks() {
  const src = path.join(ROOT, 'resources', 'flash_cards');
  const dest = path.join(SITE, 'public', 'downloads');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src).filter((n) => n.endsWith('.apkg'))) fs.copyFileSync(path.join(src, f), path.join(dest, deckFileName(f)));
}

function resolveHref(href, ctx) {
  if (!href) return { href };
  let m;
  if (href.startsWith('#')) return anchorTo(href.slice(1), ctx);
  if ((m = href.match(/^https?:\/\/github\.com\/donnemartin\/system-design-primer\/?#(.+)$/))) return anchorTo(m[1], ctx);
  if ((m = href.match(/^https?:\/\/github\.com\/donnemartin\/system-design-primer\/(?:tree|blob)\/master\/resources\/flash_cards\/([^/]+\.apkg)$/))) {
    return { href: internal('downloads/' + deckFileName(decodeURIComponent(m[1]))), download: true };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { href, external: true };
  const abs = path.posix.normalize(path.posix.join(ctx.dir, href));
  const [file, hash] = abs.split('#');
  if ((m = file.match(/^solutions\/system_design\/([^/]+)\/README\.md$/))) return { href: internal(`practice/system-design/${m[1].replace(/_/g, '-')}/`) + (hash ? `#${hash}` : '') };
  if ((m = file.match(/^solutions\/object_oriented_design\/([^/]+)\//))) return { href: internal(`practice/object-oriented/${m[1].replace(/_/g, '-')}/`) };
  if (file === 'README.md') return hash ? anchorTo(hash, ctx) : { href: internal('') };
  return { href: `${REPO}/blob/master/${file}`, external: true };
}

// ---------------------------------------------------------------- hast transform

let highlighter;
const KNOWN_LANGS = ['python', 'sql', 'bash', 'json', 'javascript', 'yaml', 'text'];

const el = (tagName, properties = {}, children = []) => ({ type: 'element', tagName, properties, children });
const text = (value) => ({ type: 'text', value });
const isBlank = (n) => n.type === 'text' && !n.value.trim();
const headingDepth = (n) => (n.type === 'element' && /^h[1-6]$/.test(n.tagName) ? Number(n.tagName[1]) : 0);

function primer(ctx) {
  return async function transform(root) {
    // 1. <p align=center><img><br><i>caption</i></p> and lone ![]() -> <figure>
    visit(root, 'element', (node, index, parent) => {
      if (node.tagName !== 'p' || !parent) return;
      const kids = node.children.filter((c) => !isBlank(c));
      const img = kids.find((c) => c.tagName === 'img');
      if (!img || !kids.every((c) => ['img', 'br', 'i', 'em'].includes(c.tagName))) return;
      const cap = kids.find((c) => c.tagName === 'i' || c.tagName === 'em');
      const figure = el('figure', { className: ['figure'] }, [img]);
      if (cap) figure.children.push(el('figcaption', {}, cap.children));
      parent.children[index] = figure;
    });

    // 2. images
    visit(root, 'element', (node) => {
      if (node.tagName !== 'img') return;
      const info = imgMap.get(node.properties.src);
      if (info) {
        node.properties.src = info.src;
        if (info.width) { node.properties.width = info.width; node.properties.height = info.height; }
      }
      const alt = node.properties.alt;
      if (!alt || alt === 'Imgur') node.properties.alt = `Diagram: ${ctx.title}`;
      node.properties.loading = 'lazy';
      node.properties.decoding = 'async';
    });

    // 3. links
    visit(root, 'element', (node) => {
      if (node.tagName !== 'a' || !node.properties.href) return;
      const r = resolveHref(String(node.properties.href), ctx);
      node.properties.href = r.href;
      if (r.download) node.properties.download = '';
      if (r.external) { node.properties.target = '_blank'; node.properties.rel = 'noopener noreferrer'; node.properties.className = ['ext']; }
    });

    // 4. tables scroll on small screens
    visit(root, 'element', (node, index, parent) => {
      if (node.tagName !== 'table' || !parent || parent.properties?.className?.includes('table-wrap')) return;
      parent.children[index] = el('div', { className: ['table-wrap'] }, [node]);
      return 'skip';
    });

    // 5. code blocks
    const blocks = [];
    visit(root, 'element', (node, index, parent) => {
      if (node.tagName === 'pre' && node.children[0]?.tagName === 'code') blocks.push({ node, index, parent });
    });
    for (const { node, parent } of blocks) {
      const code = node.children[0];
      const lang = (code.properties.className || []).map(String).find((c) => c.startsWith('language-'))?.slice(9) || 'text';
      const meta = code.data?.meta || '';
      const title = meta.match(/title="?([^"\s]+)"?/)?.[1];
      const value = hastToString(code).replace(/\n$/, '');
      const useLang = KNOWN_LANGS.includes(lang) ? lang : 'text';
      const hl = highlighter.codeToHast(value, { lang: useLang, themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false });
      const pre = hl.children[0];
      const head = el('div', { className: ['code-head'] }, [
        el('span', { className: ['code-lang'] }, [text(title || (useLang === 'text' ? 'text' : useLang))]),
        el('button', { className: ['copy-btn'], type: 'button', 'aria-label': 'Copy code' }, [text('Copy')]),
      ]);
      const wrap = el('div', { className: ['code-block', useLang === 'text' ? 'is-plain' : 'is-code'], 'data-lang': useLang }, [head, pre]);
      parent.children[parent.children.indexOf(node)] = wrap;
    }

    // 5b. interactive widgets (client script enhances these in place)
    const widget = WIDGETS[ctx.name];
    if (widget) {
      if (widget.wrap) {
        const wanted = widget.wrap === 'table' ? 'table-wrap' : 'code-block';
        const i = root.children.findIndex((n) => n.properties?.className?.includes(wanted));
        if (i >= 0) root.children[i] = el('div', { 'data-widget': widget.type, className: ['widget-host'] }, [root.children[i]]);
        else warn(`widget ${widget.type}: no ${widget.wrap} found on ${ctx.name}`);
      } else root.children.push(el('div', { 'data-widget': widget.type, className: ['widget-host'] }));
    }

    // 6. table of contents (top-level headings only)
    const heads = root.children.filter((n) => headingDepth(n) >= 2 && n.properties?.id);
    const minDepth = Math.min(...heads.map(headingDepth), 6);
    ctx.toc = heads
      .map((h) => ({ id: h.properties.id, text: hastToString(h), depth: headingDepth(h) }))
      .filter((h) => h.depth <= minDepth + 1 && !/^(Source\(s\)|Disadvantage\(s\))/.test(h.text));
    ctx.minDepth = minDepth;

    // 7. anchors on headings
    for (const h of heads) {
      h.children.push(el('a', { className: ['anchor'], href: `#${h.properties.id}`, 'aria-label': 'Link to this section', 'data-pagefind-ignore': '' }, [text('#')]));
    }

    // 8. "Disadvantage(s)" -> trade-off callout, "Source(s) and further reading" -> collapsible
    const out = [];
    const kids = root.children;
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i];
      const d = headingDepth(n);
      const title = d ? hastToString(n).replace(/#$/, '') : '';
      const isTradeoff = d && /^Disadvantage\(s\)/.test(title);
      const isSources = d && /^Source\(s\)/.test(title);
      if (!isTradeoff && !isSources) { out.push(n); continue; }
      const body = [];
      while (i + 1 < kids.length && !(headingDepth(kids[i + 1]) && headingDepth(kids[i + 1]) <= d)) body.push(kids[++i]);
      const context = title.includes(':') ? title.split(':').slice(1).join(':').trim() : '';
      if (isTradeoff) {
        out.push(el('aside', { className: ['callout', 'callout-tradeoff'], id: n.properties.id }, [
          el('div', { className: ['callout-title'] }, [text('Trade-offs'), ...(context ? [el('span', { className: ['callout-context'] }, [text(context)])] : [])]),
          ...body,
        ]));
      } else {
        let links = 0;
        for (const b of body) visit(b, 'element', (x) => { if (x.tagName === 'a') links++; });
        out.push(el('details', { className: ['sources'], id: n.properties.id }, [
          el('summary', {}, [
            text('Sources and further reading'),
            ...(context ? [el('span', { className: ['callout-context'] }, [text(context)])] : []),
            el('span', { className: ['sources-count'] }, [text(`${links} ${links === 1 ? 'link' : 'links'}`)]),
          ]),
          el('div', { className: ['sources-body'] }, body),
        ]));
      }
    }
    root.children = out;
  };
}

async function render(nodes, ctx) {
  const p = unified()
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(() => primer(ctx))
    .use(rehypeStringify);
  const tree = { type: 'root', children: nodes };
  const hast = await p.run(tree);
  const html = p.stringify(hast);
  const words = hastToString(hast).split(/\s+/).length;
  return { html, toc: ctx.toc, minutes: Math.max(1, Math.round(words / 210)) };
}

// ---------------------------------------------------------------- main

async function main() {
  highlighter = await createHighlighter({ themes: ['github-light', 'github-dark'], langs: KNOWN_LANGS.filter((l) => l !== 'text') });

  // Gather sources
  const sysDirs = fs.readdirSync(path.join(ROOT, 'solutions/system_design')).filter((d) => SOLUTIONS[d]);
  const oodDirs = fs.readdirSync(path.join(ROOT, 'solutions/object_oriented_design')).filter((d) => OOD[d]);
  const solutionMd = Object.fromEntries(sysDirs.map((d) => [d, fs.readFileSync(path.join(ROOT, `solutions/system_design/${d}/README.md`), 'utf8')]));
  const oodNb = Object.fromEntries(oodDirs.map((d) => {
    const dir = path.join(ROOT, 'solutions/object_oriented_design', d);
    const nb = fs.readdirSync(dir).find((f) => f.endsWith('.ipynb'));
    return [d, JSON.parse(fs.readFileSync(path.join(dir, nb), 'utf8'))];
  }));

  copyDecks();

  let deck = [];
  try { deck = await readDeck(path.join(ROOT, 'resources/flash_cards/System Design.apkg')); }
  catch (e) { warn(`flashcards skipped: ${e.message}`); }

  await prepareImages([readme, ...Object.values(solutionMd), ...deck.map((c) => c.back)]);

  // README -> sections
  const tree = parse(readme);
  const sections = readSections(tree);
  const byTitle = new Map(sections.map((s) => [s.title, s]));

  // Page plan + anchor map
  const pages = [];
  const addAnchors = (headings, pagePath, titleHeading) => {
    for (const h of headings) anchorMap.set(idOf(h), h === titleHeading ? pagePath : `${pagePath}#${idOf(h)}`);
  };
  const headingsIn = (nodes) => nodes.filter((n) => n.type === 'heading');
  const appendix = byTitle.get('Appendix');

  for (const spec of PAGES) {
    const pagePath = `${spec.section}/${spec.slug}/`;
    let titleHeading, nodes;
    if (spec.h2) {
      const s = byTitle.get(spec.h2);
      if (!s) { warn(`README section not found: ${spec.h2}`); continue; }
      titleHeading = s.heading; nodes = s.nodes;
    } else {
      const i = appendix.nodes.findIndex((n) => isHeading(n, 3) && mdToString(n) === spec.h3);
      if (i < 0) { warn(`Appendix section not found: ${spec.h3}`); continue; }
      let j = appendix.nodes.findIndex((n, k) => k > i && isHeading(n, 3));
      if (j < 0) j = appendix.nodes.length;
      titleHeading = appendix.nodes[i]; nodes = appendix.nodes.slice(i + 1, j);
    }
    addAnchors([titleHeading, ...headingsIn(nodes)], pagePath, titleHeading);
    pages.push({ ...spec, kind: 'topic', path: pagePath, nodes });
  }

  // About page
  const aboutNodes = [];
  const aboutHeads = [];
  for (const t of ABOUT_H2) {
    const s = byTitle.get(t);
    if (!s) { warn(`About section not found: ${t}`); continue; }
    aboutNodes.push(s.heading, ...s.nodes);
    aboutHeads.push(s.heading, ...headingsIn(s.nodes));
  }
  addAnchors(aboutHeads, 'about/');
  anchorMap.set('motivation', 'about/');
  pages.push({ kind: 'about', section: 'about', slug: 'about', path: 'about/', title: 'About', blurb: 'Why this project exists, how to contribute and who to thank.', nodes: aboutNodes });

  // Skipped sections: redirect their anchors to generated pages
  for (const t of SKIPPED_H2) {
    const s = byTitle.get(t);
    const target = ANCHOR_OVERRIDES[slugOf(t)] || 'practice/';
    anchorMap.set(idOf(s.heading), target);
    for (const h of headingsIn(s.nodes)) anchorMap.set(idOf(h), target);
  }
  anchorMap.set('appendix', 'reference/');
  for (const [id, target] of Object.entries(ANCHOR_OVERRIDES)) if (!anchorMap.has(id) || id.startsWith('coding')) anchorMap.set(id, target);

  // Anchors the Anki deck uses that no longer match a README heading
  anchorMap.set('reverse-proxy', anchorMap.get('reverse-proxy-web-server'));
  anchorMap.set('memcached', 'learn/cache/');

  // Thumbnails for the interview questions, taken from the README
  const thumbs = {};
  const questions = byTitle.get('System design interview questions with solutions');
  const links = [];
  visit({ type: 'root', children: questions.nodes }, (n) => {
    if (n.type === 'link') { const m = n.url.match(/solutions\/system_design\/([^/]+)\//); if (m) links.push(m[1]); }
    if (n.type === 'image' && links.length) thumbs[links[links.length - 1]] ??= n.url;
  });

  // Render README-derived pages
  const out = [];
  for (const p of pages) {
    const ctx = { name: p.path, dir: '', title: p.title, localIds: null };
    const r = await render(p.nodes, ctx);
    const { nodes, ...meta } = p;
    out.push({ ...meta, ...r });
  }

  // System design solutions
  const solutions = [];
  for (const d of sysDirs) {
    const slug = d.replace(/_/g, '-');
    const tr = parse(solutionMd[d]);
    const slugger = new GithubSlugger();
    for (const n of tr.children) if (n.type === 'heading') n.data = { ...n.data, hProperties: { id: slugger.slug(mdToString(n)) } };
    const h1 = tr.children.find((n) => isHeading(n, 1));
    const title = mdToString(h1);
    const body = tr.children.filter((n) => n !== h1 && !(n.type === 'paragraph' && mdToString(n).startsWith('Note: This document links')));
    const localIds = new Set(tr.children.filter((n) => n.type === 'heading').map(idOf));
    // concepts referenced by this solution
    const concepts = [];
    visit({ type: 'root', children: body }, 'link', (n) => {
      const m = n.url.match(/system-design-primer#(.+)$/);
      const target = m && anchorMap.get(m[1]);
      const pagePath = target && target.split('#')[0];
      if (pagePath && pagePath.startsWith('learn/') && !concepts.includes(pagePath)) concepts.push(pagePath);
    });
    const ctx = { name: `solution ${d}`, dir: `solutions/system_design/${d}`, title, localIds };
    const r = await render(body, ctx);
    const thumb = imgMap.get(thumbs[d])?.src;
    out.push({
      kind: 'solution', section: 'practice', slug, group: 'practice', path: `practice/system-design/${slug}/`,
      title,
      short: SOLUTIONS[d].short, blurb: SOLUTIONS[d].blurb, difficulty: SOLUTIONS[d].difficulty, thumb, concepts, ...r,
    });
    solutions.push(slug);
  }

  // Object-oriented design notebooks
  const ood = [];
  for (const d of oodDirs) {
    const slug = d.replace(/_/g, '-');
    const parts = [];
    let fileHint = '';
    for (const cell of oodNb[d].cells) {
      const src = Array.isArray(cell.source) ? cell.source.join('') : cell.source;
      if (cell.cell_type === 'markdown') { parts.push(src); continue; }
      let lines = src.split('\n');
      fileHint = '';
      lines = lines.filter((l) => {
        const w = l.match(/^%%writefile\s+(\S+)/);
        if (w) { fileHint = w[1]; return false; }
        return !l.startsWith('%');
      });
      const code = lines.join('\n').trim();
      if (code) parts.push('```python' + (fileHint ? ` title="${fileHint}"` : '') + '\n' + code + '\n```');
    }
    const tr = parse(parts.join('\n\n'));
    const slugger = new GithubSlugger();
    for (const n of tr.children) if (n.type === 'heading') n.data = { ...n.data, hProperties: { id: slugger.slug(mdToString(n)) } };
    const h1 = tr.children.find((n) => isHeading(n, 1));
    const title = h1 ? mdToString(h1) : slug;
    const body = tr.children.filter((n) => n !== h1 && !(n.type === 'paragraph' && mdToString(n).startsWith('This notebook was prepared by')));
    const ctx = { name: `ood ${d}`, dir: `solutions/object_oriented_design/${d}`, title, localIds: new Set(tr.children.filter((n) => n.type === 'heading').map(idOf)) };
    const r = await render(body, ctx);
    out.push({ kind: 'ood', section: 'practice', slug, group: 'practice', path: `practice/object-oriented/${slug}/`, title, blurb: OOD[d].blurb, ...r });
    ood.push(slug);
  }

  const cardCtx = { name: 'flashcards', dir: '', localIds: null };
  const cards = deck.map((c) => ({
    front: cardTitle(c.front),
    back: cleanCard(c.back, { resolveHref: (h) => resolveHref(h, cardCtx), resolveImg: (src) => imgMap.get(src) }),
  })).filter((c) => c.front && c.back);

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'flashcards.json'), JSON.stringify(cards));
  fs.writeFileSync(path.join(OUT, 'site.json'), JSON.stringify({ base: BASE, repo: REPO, groups: GROUPS, solutions, ood, pages: out }));
  const kb = Math.round(fs.statSync(path.join(OUT, 'site.json')).size / 1024);
  console.log(`content: ${out.length} pages (${solutions.length} solutions, ${ood.length} OOD), ${imgMap.size} images, ${cards.length} flashcards, ${kb} KB`);
  if (warnings.length) console.warn(`\n${warnings.length} warning(s):\n` + [...new Set(warnings)].map((w) => '  - ' + w).join('\n'));
}

main().catch((e) => { console.error(e); process.exit(1); });
