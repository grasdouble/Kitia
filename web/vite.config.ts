import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { browserInkPlugins } from './browserInkPlugin';

const root = fileURLToPath(new URL('.', import.meta.url));

function pageRoutes(): Plugin {
  return {
    name: 'page-routes',
    enforce: 'post',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const match = request.url?.match(/^\/(demo|demo-keep|changelog)\/?(\?.*)?$/);
        if (match) request.url = `/pages/${match[1]}/index.html${match[2] ?? ''}`;
        next();
      });
    },
    generateBundle(_options, bundle) {
      for (const name of ['changelog', 'demo', 'demo-keep']) {
        const source = `pages/${name}/index.html`;
        const page = bundle[source];
        if (!page) continue;
        delete bundle[source];
        page.fileName = `${name}/index.html`;
        bundle[page.fileName] = page;
      }
    },
  };
}

export default defineConfig({
  root,
  base: '/',
  plugins: [...browserInkPlugins(), pageRoutes()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        home: fileURLToPath(new URL('./index.html', import.meta.url)),
        changelog: fileURLToPath(new URL('./pages/changelog/index.html', import.meta.url)),
        demo: fileURLToPath(new URL('./pages/demo/index.html', import.meta.url)),
        'demo-keep': fileURLToPath(new URL('./pages/demo-keep/index.html', import.meta.url)),
      },
    },
  },
});
