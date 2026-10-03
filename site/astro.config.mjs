import { defineConfig } from 'astro/config';

const base = process.env.SITE_BASE || '/';

export default defineConfig({
  site: process.env.SITE_URL,
  base,
  trailingSlash: 'always',
  build: { format: 'directory' },
  devToolbar: { enabled: false },
});
