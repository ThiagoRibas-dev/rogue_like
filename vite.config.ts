import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

/** Base path for GitHub Pages deployment (`/rogue_like/`). */
const base = process.env['GITHUB_PAGES'] === 'true' ? '/rogue_like/' : '/';

export default defineConfig({
  base,
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    target: 'es2022'
  }
});
