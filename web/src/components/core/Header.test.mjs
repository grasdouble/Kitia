import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { createComponentRouter } from '../../../test/router-fixture.mjs';

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

test('mobile navigation follows router state, closes on selection, and preserves native modified clicks', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://kitia.test/' });
  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const globals = {
    window: dom.window,
    self: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    MouseEvent: dom.window.MouseEvent,
    history: dom.window.history,
    sessionStorage: dom.window.sessionStorage,
    addEventListener: dom.window.addEventListener.bind(dom.window),
    removeEventListener: dom.window.removeEventListener.bind(dom.window),
    scrollTo: dom.window.scrollTo,
    scrollX: 0,
    scrollY: 0,
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
    const { RouterProvider } = await import('@tanstack/react-router');
    const { Header } = await vite.ssrLoadModule('/src/components/core/Header.tsx');
    const router = await createComponentRouter(React.createElement(Header), { initialEntries: ['/demo/'] });
    const container = document.querySelector('#root');
    reactRoot = createRoot(container);
    await React.act(async () => reactRoot.render(React.createElement(RouterProvider, { router })));

    const button = container.querySelector('button[aria-controls="primary-navigation"]');
    const nav = container.querySelector('#primary-navigation');
    const click = async (element, options = {}) => {
      await React.act(async () => {
        element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, ...options }));
      });
    };
    const currentLink = () => nav.querySelector('a[aria-current="page"]')?.getAttribute('href');
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(button.getAttribute('aria-label'), 'Open navigation menu');
    assert.equal(button.getAttribute('aria-controls'), nav.id);
    assert.equal(currentLink(), '/demo');
    assert.equal(nav.querySelectorAll('a[aria-current="page"]').length, 1);

    for (const [href, event] of [['/', 'nav_home'], ['/demo', 'nav_demo'], ['/changelog', 'nav_changelog']]) {
      await click(button);
      assert.equal(button.getAttribute('aria-expanded'), 'true');
      assert.equal(button.getAttribute('aria-label'), 'Close navigation menu');
      const link = nav.querySelector(`a[href="${href}"]`);
      assert.equal(link.getAttribute('data-ga-event'), event);
      await click(link);
      assert.equal(router.state.location.pathname, href);
      assert.equal(currentLink(), href);
      assert.equal(nav.querySelectorAll('a[aria-current="page"]').length, 1);
      assert.equal(button.getAttribute('aria-expanded'), 'false');
      assert.equal(button.getAttribute('aria-label'), 'Open navigation menu');
    }

    await React.act(async () => router.navigate({ to: '/changelog/' }));
    assert.equal(currentLink(), '/changelog');
    await React.act(async () => router.navigate({ to: '/demo-keep/' }));
    assert.equal(currentLink(), '/demo');

    await click(container.querySelector('a[aria-label="Kitia home"]'));
    assert.equal(router.state.location.pathname, '/');
    assert.equal(router.state.location.hash, 'top');
    assert.equal(currentLink(), '/');

    for (const options of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      let defaultPrevented;
      document.addEventListener('click', (event) => {
        defaultPrevented = event.defaultPrevented;
        event.preventDefault();
      }, { once: true });
      await click(nav.querySelector('a[href="/demo"]'), options);
      assert.equal(defaultPrevented, false);
      assert.equal(router.state.location.pathname, '/');
      assert.equal(router.state.location.hash, 'top');
    }
    assert.equal(container.querySelector('a[data-ga-event="header_github"]').getAttribute('href'), 'https://github.com/grasdouble/Kitia');
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    dom.window.close();
    for (const name of Object.keys(globals)) {
      const descriptor = previousGlobals.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
