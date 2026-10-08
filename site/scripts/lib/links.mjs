// Link and anchor resolution for README-derived content. Pure (no file system access)
// so it can be unit tested; build-content.mjs wires in the real anchor map.
import path from 'node:path';

// "System Design Exercises.apkg" -> "system-design-exercises.apkg"
export const deckFileName = (name) =>
  name.replace(/\.apkg$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.apkg';

/**
 * @param {object} o
 * @param {string} o.base       site base path with trailing slash, e.g. "/" or "/primer/"
 * @param {string} o.repo       upstream repository URL (used for links to files we do not render)
 * @param {Map<string,string>} o.anchorMap  heading id -> page path, optionally with "#id"
 * @param {(msg: string, fatal?: boolean) => void} o.warn
 */
export function createLinkResolver({ base, repo, anchorMap, warn }) {
  const internal = (p) => base + p;

  // ctx: { name, dir, localIds } — `dir` is the folder of the markdown file being rendered.
  function anchorTo(id, ctx) {
    id = decodeURIComponent(id).split('>')[0]; // some upstream links carry stray ">1" suffixes
    if (ctx.localIds?.has(id)) return { href: `#${id}` };
    const target = anchorMap.get(id);
    if (!target) {
      warn(`unresolved anchor #${id} (in ${ctx.name})`, true);
      return { href: `${repo}#${id}`, external: true };
    }
    return { href: internal(target) };
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
    return { href: `${repo}/blob/master/${file}`, external: true };
  }

  return { resolveHref, anchorTo, internal };
}
