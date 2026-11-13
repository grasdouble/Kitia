import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const vite = await createServer({
  configFile: path.join(projectRoot, 'web/vite.config.ts'),
  logLevel: 'silent',
  server: { middlewareMode: true },
  appType: 'custom',
});

after(async () => {
  await vite.close();
});

test('mobile page navigation closes after selection and marks the current page', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://kitia.test/' });
  const globalNames = ['window', 'document', 'navigator', 'HTMLElement', 'MouseEvent', 'IS_REACT_ACT_ENVIRONMENT'];
  const previousGlobals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    MouseEvent: dom.window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }

  let reactRoot;
  let React;
  try {
    React = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { Header } = await vite.ssrLoadModule('/src/components/core/Header.tsx');
    const container = document.querySelector('#root');
    reactRoot = createRoot(container);
    await React.act(async () => reactRoot.render(React.createElement(Header)));

    const button = container.querySelector('button[aria-controls="primary-navigation"]');
    const nav = container.querySelector('#primary-navigation');
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(button.getAttribute('aria-label'), 'Open navigation menu');
    assert.equal(button.getAttribute('aria-controls'), nav.id);
    assert.equal(nav.querySelector('a[aria-current="page"]').getAttribute('href'), '/');

    await React.act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.equal(button.getAttribute('aria-label'), 'Close navigation menu');

    container.addEventListener('click', (event) => {
      if (event.target.closest('a')) event.preventDefault();
    });
    await React.act(async () => nav.querySelector('a[href="/demo"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })));
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(button.getAttribute('aria-label'), 'Open navigation menu');
    window.history.pushState(null, '', '/demo');
    await React.act(async () => reactRoot.render(React.createElement(Header)));
    assert.equal(nav.querySelector('a[aria-current="page"]').getAttribute('href'), '/demo');
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    dom.window.close();
    for (const name of globalNames) {
      const descriptor = previousGlobals.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
