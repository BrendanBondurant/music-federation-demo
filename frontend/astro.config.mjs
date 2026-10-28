// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// Server-rendered on purpose: every page fetches live data from the Cosmo
// Router on each request, so the site is always exactly what the subgraphs
// say — no baked snapshot. Boot the backend first (npm start in the repo
// root), then npm run dev here.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
});
