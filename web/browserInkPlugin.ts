import inject from '@rollup/plugin-inject';
import commonjs from 'vite-plugin-commonjs';
import { builtinModules, createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type Plugin } from 'vite';

const require = createRequire(import.meta.url);
const adapter = (name: string) => fileURLToPath(new URL(`./src/components/demo/terminalRuntime/${name}`, import.meta.url));
const globals = adapter('globals.js');

/** Keep Node compatibility local to the terminal module graph, never window globals. */
export function browserInkPlugins(): Plugin[] {
  const packages: Record<string, string> = {
    buffer: require.resolve('buffer/'),
    events: require.resolve('events/'),
    stream: require.resolve('readable-stream/lib/ours/browser.js'),
    string_decoder: require.resolve('string_decoder/'),
    path: require.resolve('path-browserify'),
    util: adapter('util.js'),
    process: adapter('process.js'),
    url: adapter('url.js'),
    fs: adapter('filesystem.js'),
    module: adapter('module.js'),
    tty: adapter('tty.js'),
    os: adapter('os.js'),
  };
  return [
    {
      name: 'kitia-browser-ink',
      enforce: 'pre',
      config: () => ({
        resolve: {
          alias: [
            ...Object.entries(packages).map(([name, replacement]) => ({ find: new RegExp(`^(?:node:)?${name}$`), replacement })),
            { find: /^cli-cursor$/, replacement: adapter('cursor.js') },
            { find: /^signal-exit$/, replacement: adapter('signalExit.js') },
            { find: /^(?:#)?supports-color$/, replacement: adapter('supportsColor.js') },
            { find: /^terminal-size$/, replacement: adapter('terminalSize.js') },
          ],
        },
        define: {
          'process.env.KITIA_INSTALLED_VERSION': JSON.stringify('unknown'),
          'process.env.DEV': JSON.stringify('false'),
          __KITIA_NODE_BUILTINS__: JSON.stringify(builtinModules),
        },
        optimizeDeps: {
          include: ['ink'],
          esbuildOptions: {
            target: 'esnext',
            inject: ['kitia-terminal-globals'],
            plugins: [{
              name: 'kitia-terminal-globals',
              setup(build) {
                build.onResolve({ filter: /^kitia-terminal-globals$/ }, () => ({ path: globals, namespace: 'kitia-terminal-globals' }));
                build.onLoad({ filter: /.*/, namespace: 'kitia-terminal-globals' }, () => ({
                  contents: readFileSync(globals, 'utf8'),
                  loader: 'js',
                  resolveDir: dirname(globals),
                }));
              },
            }],
          },
        },
        build: { target: 'esnext' },
      }),
      transform(code, id) {
        const file = id.split('?')[0];
        if (!file.endsWith('/cli/src/dashboard/helpers.mts') && !file.endsWith('/cli/src/dashboard/source-highlighting.mts')) return;
        // These two ESM files use createRequire only for static CJS dependencies.
        // Expose those exact dependencies to Vite; the CLI source stays untouched.
        let transformed = code
          .replace(/import \{ createRequire \} from ["']node:module["'];?\s*/g, '')
          .replace(/const require = createRequire\(import\.meta\.url\);?\s*/g, '');
        const imports: string[] = [];
        transformed = transformed.replace(/^[ \t]*require\((["'])([^"']+)\1\);?[ \t]*$|require\((["'])([^"']+)\3\)/gm, (_match, _statementQuote, statementSource: string | undefined, _expressionQuote, expressionSource: string) => {
          if (statementSource !== undefined) {
            imports.push(`import ${JSON.stringify(statementSource)};`);
            return '';
          }
          const name = `__kitiaCjs${imports.length}`;
          imports.push(`import ${name} from ${JSON.stringify(expressionSource)};`);
          return name;
        });
        return { code: `${imports.join('\n')}\n${transformed}`, map: null };
      },
    },
    commonjs({ filter: (id) => id.includes('/cli/src/') }),
    {
      ...inject({
        include: ['**/cli/src/**', '**/node_modules/**'],
        exclude: ['**/terminalRuntime/**'],
        process: [globals, 'process'],
        Buffer: [globals, 'Buffer'],
        setImmediate: [globals, 'setImmediate'],
        clearImmediate: [globals, 'clearImmediate'],
      }),
      enforce: 'post',
    } as Plugin,
  ];
}
