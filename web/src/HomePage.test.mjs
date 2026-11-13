import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { createComponentRouter } from '../test/router-fixture.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const vite = await createServer({
  configFile: path.join(projectRoot, 'web/vite.config.ts'),
  logLevel: 'silent',
  server: { middlewareMode: true },
  appType: 'custom',
});
after(() => vite.close());

test('the final section activates at the reachable scroll limit and updates after scrolling or resizing', async () => {
  const dom = new JSDOM('<!doctype html><header></header><div id="root"></div>', { url: 'https://kitia.test/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'ResizeObserver', 'IS_REACT_ACT_ENVIRONMENT',
    'self', 'history', 'sessionStorage', 'addEventListener', 'removeEventListener', 'scrollTo', 'scrollX', 'scrollY'];
  const previous = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let scrollY = 0;
  let viewportHeight = 1100;
  let pageHeight = 4000;
  let pendingFrame;
  let notifyResize;
  const observed = new Set();
  class GeometryObserver {
    constructor(callback) { notifyResize = callback; }
    observe(target) { observed.add(target); }
    disconnect() { observed.clear(); }
  }
  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  for (const [name, value] of Object.entries({
    window: dom.window,
    self: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    ResizeObserver: GeometryObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
    history: dom.window.history,
    sessionStorage: dom.window.sessionStorage,
    addEventListener: dom.window.addEventListener.bind(dom.window),
    removeEventListener: dom.window.removeEventListener.bind(dom.window),
    scrollTo: dom.window.scrollTo,
    scrollX: 0,
    scrollY: 0,
  })) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  Object.defineProperty(window, 'scrollY', { get: () => scrollY });
  Object.defineProperty(window, 'innerHeight', { get: () => viewportHeight });
  Object.defineProperty(document.documentElement, 'scrollHeight', { get: () => pageHeight });
  window.matchMedia = () => ({ matches: true });
  window.requestAnimationFrame = (callback) => { pendingFrame = callback; return 1; };
  window.cancelAnimationFrame = () => { pendingFrame = undefined; };

  let root;
  let React;
  try {
    React = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { HomePage } = await vite.ssrLoadModule('/src/HomePage.tsx');
    const { RouterProvider } = await import('@tanstack/react-router');
    const router = await createComponentRouter(React.createElement(HomePage));
    root = createRoot(document.querySelector('#root'));
    await React.act(async () => root.render(React.createElement(RouterProvider, { router })));
    document.querySelector('header').getBoundingClientRect = () => new dom.window.DOMRect(0, 0, 1200, 77);
    const tops = { approach: 800, dashboard: 1500, workflow: 2500, commands: 3200 };
    for (const [id, top] of Object.entries(tops)) {
      document.getElementById(id).getBoundingClientRect = () => new dom.window.DOMRect(0, top - scrollY, 1000, 500);
    }
    const flush = async () => {
      const callback = pendingFrame;
      pendingFrame = undefined;
      await React.act(async () => callback?.(0));
    };
    const move = async (position) => {
      scrollY = position;
      window.dispatchEvent(new dom.window.Event('scroll'));
      await flush();
    };
    const active = () => document.querySelector('nav[aria-label="On this page"] a[aria-current="location"]')?.getAttribute('href');

    await flush();
    assert.equal(active(), undefined);
    await move(900);
    assert.equal(active(), '#approach');
    await move(2800);
    assert.equal(active(), '#workflow');
    await move(2898);
    assert.equal(active(), '#workflow', 'do not activate the final section before its reachable boundary');
    await move(2899.5);
    assert.equal(active(), '#commands', 'fractional scroll rounding must not make the final section unreachable');
    await move(2900);
    assert.equal(active(), '#commands', 'Automation is active even though its heading remains 300px below the viewport top');
    assert.equal(document.querySelectorAll('nav[aria-label="On this page"] a[aria-current]').length, 1);
    await move(2800);
    assert.equal(active(), '#workflow', 'scrolling back up must clear the end-of-page selection');

    viewportHeight = 1400;
    scrollY = 2600;
    window.dispatchEvent(new dom.window.Event('resize'));
    await flush();
    assert.equal(active(), '#commands', 'a taller viewport must use its new reachable boundary');
    pageHeight = 4600;
    notifyResize();
    await flush();
    assert.equal(active(), '#workflow', 'content growth must not leave the old end-of-page selection stuck');
  } finally {
    if (root) await React.act(async () => root.unmount());
    dom.window.close();
    for (const name of names) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
