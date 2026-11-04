import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  base: '/Kitia/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
