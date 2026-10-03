import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const base = process.env.SITE_BASE || '/';
const site = process.env.SITE_URL;

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  build: { format: 'directory' },
  devToolbar: { enabled: false },
  // A sitemap needs absolute URLs, so only emit one when the public address is known (CI sets SITE_URL).
  integrations: site ? [sitemap()] : [],
});
