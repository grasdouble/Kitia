import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

function changelogRoute(): Plugin {
  return {
    name: 'changelog-route',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const page = bundle['pages/changelog/index.html'];
      if (!page) return;
      delete bundle['pages/changelog/index.html'];
      page.fileName = 'changelog/index.html';
      bundle[page.fileName] = page;
    },
  };
}

export default defineConfig({
  root,
  base: '/',
  plugins: [changelogRoute()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        home: fileURLToPath(new URL('./index.html', import.meta.url)),
        changelog: fileURLToPath(new URL('./pages/changelog/index.html', import.meta.url)),
      },
    },
  },
});
