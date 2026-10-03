# System Design Primer: reading site

A static site that renders the repository's `README.md` and `solutions/` as a searchable, navigable guide.
The markdown in the repo stays the single source of truth; nothing under `site/` duplicates content.

```bash
cd site
npm install
npm run dev        # regenerate content, then start the dev server
npm run build      # content + static build + Pagefind search index -> dist/
npm run preview    # serve dist/ (needed to try full-text search)
node scripts/check-links.mjs   # verify every internal link and anchor in dist/
```

## How it works

| Step | Where |
|---|---|
| Split `README.md` into pages, rewrite links and anchors, highlight code, wrap trade-off and source sections | `scripts/build-content.mjs` |
| Decide which README section becomes which page, its group and blurb | `scripts/site-map.mjs` |
| Render pages, navigation, search | `src/` (Astro) |
| Interactive widgets (study planner, latency explorer, powers of two, nines calculator, flashcards from the Anki deck) | `src/scripts/widgets.ts`, enabled per page in `site-map.mjs` (`WIDGETS`) |

Remote diagrams (imgur) are downloaded once into `public/img/remote/` so the site does not depend on third-party hosting. Commit that folder.

For a GitHub Pages project site, build with `SITE_BASE=/<repo>/` (the workflow in `.github/workflows/deploy-site.yml` does this).

Live site: https://skshubham1437.github.io/system-design-primer/
