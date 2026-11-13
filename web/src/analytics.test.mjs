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

async function withAnalytics(run, { strict = false, initialEntries = ['/'] } = {}) {
  // Install the browser globals before importing React DOM and the router.
  // JSDOM does not load external resources, so the GA script never makes a request.
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
    url: 'https://kitia.test/',
  });
  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const globals = {
    window: dom.window,
    self: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
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
  let router;
  try {
    React = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { createMemoryHistory, createRootRoute, createRoute, createRouter, HeadContent, Link, Outlet, RouterProvider } =
      await import('@tanstack/react-router');
    const { useGoogleAnalytics } = await vite.ssrLoadModule('/src/analytics.ts');
    function Analytics() {
      useGoogleAnalytics();
      return null;
    }
    const rootRoute = createRootRoute({
      component: () => React.createElement(React.Fragment, null,
        React.createElement(HeadContent),
        React.createElement(Analytics),
        React.createElement(Link, { to: '/demo', 'data-ga-event': 'hero_try_demo' },
          React.createElement('span', null, 'Try demo')),
        React.createElement(Link, { to: '/', hash: 'dashboard', 'data-ga-event': 'hero_explore_dashboard' },
          React.createElement('span', null, 'Explore dashboard')),
        React.createElement('a', {
          href: 'https://github.com/grasdouble/Kitia',
          'data-ga-event': 'footer_github',
          onClick: (event) => event.preventDefault(),
        }, React.createElement('span', null, '  View \n GitHub  ')),
        React.createElement('a', { href: '#untagged', onClick: (event) => event.preventDefault() }, 'Untagged'),
        React.createElement(Outlet)),
    });
    const routes = [
      ['/', 'Kitia home'],
      ['/demo', 'Kitia demo'],
      ['/demo-keep', 'Kitia persistent demo'],
      ['/changelog', 'Kitia changelog'],
    ].map(([routePath, title]) => createRoute({
      getParentRoute: () => rootRoute,
      path: routePath,
      head: () => ({ meta: [{ title }] }),
      component: () => React.createElement('main', null, title),
    }));
    router = createRouter({
      routeTree: rootRoute.addChildren(routes),
      history: createMemoryHistory({ initialEntries }),
      defaultHashScrollIntoView: false,
      defaultPendingMinMs: 0,
    });
    await router.load();
    const render = async () => {
      reactRoot = createRoot(document.querySelector('#root'));
      const provider = React.createElement(RouterProvider, { router });
      await React.act(async () => reactRoot.render(strict ? React.createElement(React.StrictMode, null, provider) : provider));
    };
    const unmount = async () => {
      await React.act(async () => reactRoot.unmount());
      reactRoot = undefined;
    };
    const navigate = async (options) => {
      let navigation;
      await React.act(async () => { navigation = router.navigate(options); });
      await navigation;
    };
    const travel = async (direction) => {
      let resolved;
      await React.act(async () => {
        resolved = new Promise((resolve) => {
          const unsubscribe = router.subscribe('onResolved', () => {
            unsubscribe();
            resolve();
          });
        });
        router.history[direction]();
      });
      await resolved;
    };
    const click = async (selector) => {
      await React.act(async () => document.querySelector(selector).dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
      ));
    };
    const commands = () => {
      // Google Tag Manager recognizes commands as arguments objects, not arrays.
      assert.ok(window.dataLayer.every(types.isArgumentsObject));
      return window.dataLayer.map((command) => Array.from(command));
    };
    const views = () => commands().filter(([name, event]) => name === 'event' && event === 'page_view').map(([, , data]) => data);
    await render();
    await run({ commands, views, navigate, travel, click, unmount, render, router, React, dom });
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    router?.history.destroy();
    dom.window.close();
    for (const [name, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test('resolved routes send one view with the committed title, ignoring hashes and tracking search and history', async () => {
  await withAnalytics(async ({ commands, views, navigate, travel, click }) => {
    assert.deepEqual(views(), [{ page_location: 'https://kitia.test/', page_title: 'Kitia home' }]);
    assert.ok(commands().find(([name]) => name === 'js')?.[1] instanceof Date);
    assert.deepEqual(commands().find(([name]) => name === 'config'), [
      'config', 'G-9GDELT6HDR', { send_page_view: false },
    ]);
    await click('[data-ga-event="hero_try_demo"] span');
    assert.deepEqual(views().at(-1), { page_location: 'https://kitia.test/demo', page_title: 'Kitia demo' });
    assert.equal(views().length, 2);

    await navigate({ to: '/demo', hash: 'terminal' });
    assert.equal(views().length, 2);
    await navigate({ to: '/demo', search: { mode: 'compact' } });
    assert.deepEqual(views().at(-1), {
      page_location: 'https://kitia.test/demo?mode=compact',
      page_title: 'Kitia demo',
    });
    assert.equal(views().length, 3);

    await travel('back');
    assert.deepEqual(views().at(-1), { page_location: 'https://kitia.test/demo#terminal', page_title: 'Kitia demo' });
    assert.equal(views().length, 4);
    await travel('back');
    assert.equal(views().length, 4);
    await travel('back');
    assert.deepEqual(views().at(-1), { page_location: 'https://kitia.test/', page_title: 'Kitia home' });
    assert.equal(views().length, 5);
    await travel('forward');
    assert.deepEqual(views().at(-1), { page_location: 'https://kitia.test/demo', page_title: 'Kitia demo' });
    assert.equal(views().length, 6);
    await travel('forward');
    assert.equal(views().length, 6);

    await navigate({ to: '/demo-keep' });
    assert.deepEqual(views().at(-1), {
      page_location: 'https://kitia.test/demo-keep', page_title: 'Kitia persistent demo',
    });
    await navigate({ to: '/changelog' });
    assert.deepEqual(views().at(-1), {
      page_location: 'https://kitia.test/changelog', page_title: 'Kitia changelog',
    });
    assert.equal(views().length, 8);
  });
});

test('tagged section, SPA and external clicks retain their event names and link fields', async () => {
  await withAnalytics(async ({ commands, views, click }) => {
    await click('[data-ga-event="hero_explore_dashboard"] span');
    assert.equal(views().length, 1);
    await click('[data-ga-event="footer_github"] span');
    await click('a[href="#untagged"]');
    await click('[data-ga-event="hero_try_demo"] span');
    const clicks = commands().filter(([name, event]) => name === 'event' && event !== 'page_view');
    assert.deepEqual(clicks, [
      ['event', 'hero_explore_dashboard', {
        link_text: 'Explore dashboard', link_url: 'https://kitia.test/#dashboard',
      }],
      ['event', 'footer_github', {
        link_text: 'View GitHub', link_url: 'https://github.com/grasdouble/Kitia',
      }],
      ['event', 'hero_try_demo', {
        link_text: 'Try demo', link_url: 'https://kitia.test/demo',
      }],
    ]);
  });
});

test('StrictMode and remounts initialize once, clean up listeners and resume tracking', async () => {
  await withAnalytics(async ({ commands, views, navigate, click, unmount, render, dom }) => {
    const scriptSelector = 'script[src="https://www.googletagmanager.com/gtag/js?id=G-9GDELT6HDR"]';
    const script = document.querySelector(scriptSelector);
    assert.ok(script?.async);
    assert.equal(document.querySelectorAll(scriptSelector).length, 1);
    assert.equal(commands().filter(([name]) => name === 'js').length, 1);
    assert.equal(commands().filter(([name]) => name === 'config').length, 1);
    assert.equal(views().length, 1);
    await click('[data-ga-event="footer_github"] span');
    assert.equal(commands().filter(([, event]) => event === 'footer_github').length, 1);
    await navigate({ to: '/demo' });
    assert.equal(views().length, 2);

    await unmount();
    const count = commands().length;
    const link = document.createElement('a');
    link.href = '#after-unmount';
    link.dataset.gaEvent = 'after_unmount';
    link.addEventListener('click', (event) => event.preventDefault());
    document.body.appendChild(link);
    link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(commands().length, count);
    link.remove();
    assert.equal(document.querySelector(scriptSelector), script);

    await render();
    assert.equal(commands().filter(([name]) => name === 'js').length, 1);
    assert.equal(commands().filter(([name]) => name === 'config').length, 1);
    assert.equal(document.querySelectorAll(scriptSelector).length, 1);
    assert.equal(views().length, 2);
    await click('[data-ga-event="footer_github"] span');
    assert.equal(commands().filter(([, event]) => event === 'footer_github').length, 2);
    await navigate({ to: '/changelog' });
    assert.equal(views().length, 3);
    assert.deepEqual(views().at(-1), {
      page_location: 'https://kitia.test/changelog', page_title: 'Kitia changelog',
    });
  }, { strict: true });
});
