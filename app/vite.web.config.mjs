import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

export default defineConfig({
  // npm pack --json reserves stdout for the package manifest.
  logLevel: 'warn',
  root: fileURLToPath(new URL('./src/web/client/', import.meta.url)),
  esbuild: { jsx: 'automatic' },
  build: { outDir: fileURLToPath(new URL('./dist/web/client/', import.meta.url)), emptyOutDir: true },
});
