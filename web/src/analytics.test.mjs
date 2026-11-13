import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { types } from 'node:util';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const vite = await createServer({
  configFile: path.join(projectRoot, 'web/vite.config.ts'),
  logLevel: 'silent',
  server: { middlewareMode: true },
  appType: 'custom',
});

after(async () => {
  await vite.close();
});

test('page initialization and tagged clicks produce Google-compatible commands', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://kitia.test/' });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Element: dom.window.Element,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previousGlobals = new Map(Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }

  let reactRoot;
  let React;
  try {
    React = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { useGoogleAnalytics } = await vite.ssrLoadModule('/src/analytics.ts');
    function AnalyticsPage() {
      useGoogleAnalytics();
      return React.createElement('a', { href: '#dashboard', 'data-ga-event': 'hero_explore_dashboard' },
        React.createElement('span', null, 'Explore dashboard'));
    }
    reactRoot = createRoot(document.querySelector('#root'));
    await React.act(async () => reactRoot.render(React.createElement(AnalyticsPage)));
    await React.act(async () => document.querySelector('a span').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));

    // Google Tag Manager recognizes gtag commands as arguments objects, not arrays.
    const commands = window.dataLayer.filter(types.isArgumentsObject).map((command) => Array.from(command));
    const initialization = commands.find(([name]) => name === 'js');
    assert.ok(initialization?.[1] instanceof Date);
    assert.deepEqual(commands.find(([name]) => name === 'config'), ['config', 'G-9GDELT6HDR']);
    assert.deepEqual(commands.find(([name]) => name === 'event'), [
      'event', 'hero_explore_dashboard',
      { link_text: 'Explore dashboard', link_url: 'https://kitia.test/#dashboard' },
    ]);
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    dom.window.close();
    for (const [name, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
