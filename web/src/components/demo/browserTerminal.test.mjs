import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { after, test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

import { createComponentRouter } from '../../../test/router-fixture.mjs';

let fixture;
const moduleNames = new Map([
  ['@xterm/xterm', 'Terminal'],
  ['@xterm/addon-fit', 'FitAddon'],
  ['ink', 'render'],
  ['@xterm/xterm/css/xterm.css', 'style'],
]);
const mockPrefix = '\0kitia-lifecycle-test:';

class Terminal {
  input = new Set();
  resizeHandlers = new Set();
  focusCount = 0;
  disposeCount = 0;

  constructor({ cols, rows }) {
    Object.assign(this, { cols, rows });
    fixture.terminals.push(this);
  }

  write(_chunk, done) {
    if (this.pauseWrites) this.queuedWrite = done;
    else done();
  }

  loadAddon() {}

  open(host) {
    this.textarea = host.ownerDocument.createElement('textarea');
    host.append(this.textarea);
  }

  onData(handler) {
    this.input.add(handler);
    return { dispose: () => this.input.delete(handler) };
  }

  onResize(handler) {
    this.resizeHandlers.add(handler);
    return { dispose: () => this.resizeHandlers.delete(handler) };
  }

  resize(cols, rows) {
    Object.assign(this, { cols, rows });
    for (const handler of this.resizeHandlers) handler({ cols, rows });
  }

  focus() {
    this.focusCount++;
    this.textarea.focus();
  }

  dispose() {
    this.disposeCount++;
  }
}

class FitAddon {
  proposeDimensions() {
    return fixture.dimensions;
  }
}

function render(element, options) {
  const initial = Promise.withResolvers();
  const exit = Promise.withResolvers();
  const app = {
    initial,
    exit,
    element,
    options,
    unmountCount: 0,
    waitUntilRenderFlush: () => initial.promise,
    waitUntilExit: () => exit.promise,
    unmount() {
      this.unmountCount++;
    },
  };
  const index = fixture.apps.push(app) - 1;
  fixture.waitingApps.get(index)?.resolve(app);
  return app;
}

globalThis.kitiaLifecycleTestModules = { Terminal, FitAddon, render, Dashboard: () => null };
const vite = await createServer({
  configFile: false,
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  logLevel: 'silent',
  server: { middlewareMode: true },
  appType: 'custom',
  ssr: { noExternal: [...moduleNames.keys()] },
  plugins: [
    {
      name: 'kitia-lifecycle-test-runtime',
      enforce: 'pre',
      resolveId(id, importer) {
        if (importer?.endsWith('/browserTerminal.ts') && moduleNames.has(id)) return mockPrefix + moduleNames.get(id);
        if (importer?.endsWith('/TuiDemo.tsx') && id === '@grasdouble/kitia/src/tui/dashboard.mts') {
          return `${mockPrefix}Dashboard`;
        }
      },
      load(id) {
        if (!id.startsWith(mockPrefix)) return;
        const name = id.slice(mockPrefix.length);
        return name === 'style' ? 'export {}' : `export const ${name} = globalThis.kitiaLifecycleTestModules.${name};`;
      },
    },
  ],
});
after(async () => {
  await vite.close();
  delete globalThis.kitiaLifecycleTestModules;
});
const { mountDashboardTerminal } = await vite.ssrLoadModule('/src/components/demo/browserTerminal.ts');

function createFixture(t, { waitForFonts = false } = {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://kitia.test/demo/' });
  dom.window.scrollTo = () => {};
  const fontsReady = Promise.withResolvers();
  const fontsAccessed = Promise.withResolvers();
  Object.defineProperty(dom.window.document, 'fonts', {
    get() {
      fontsAccessed.resolve();
      return { ready: fontsReady.promise };
    },
  });
  if (!waitForFonts) fontsReady.resolve();
  fixture = {
    apps: [],
    terminals: [],
    observers: [],
    waitingApps: new Map(),
    dimensions: { cols: 100, rows: 40 },
    fontsReady,
    fontsAccessed,
    dom,
    root: dom.window.document.querySelector('#root'),
    appAt(index) {
      if (this.apps[index]) return Promise.resolve(this.apps[index]);
      if (!this.waitingApps.has(index)) this.waitingApps.set(index, Promise.withResolvers());
      return this.waitingApps.get(index).promise;
    },
  };
  const globals = {
    window: dom.window,
    self: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    history: dom.window.history,
    sessionStorage: dom.window.sessionStorage,
    addEventListener: dom.window.addEventListener.bind(dom.window),
    removeEventListener: dom.window.removeEventListener.bind(dom.window),
    scrollTo: dom.window.scrollTo,
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class {
      disconnectCount = 0;

      constructor(notify) {
        this.notify = notify;
        fixture.observers.push(this);
      }

      observe(container) {
        this.target = container;
      }

      disconnect() {
        this.disconnectCount++;
        this.target = null;
      }
    },
  };
  const previous = Object.fromEntries(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  t.after(() => {
    dom.window.close();
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return fixture;
}

function assertDisposed({ apps, terminals, observers }, index) {
  assert.equal(apps[index].unmountCount, 1);
  assert.equal(apps[index].options.stdin.destroyed, true);
  assert.equal(apps[index].options.stdout.destroyed, true);
  assert.equal(terminals[index].disposeCount, 1);
  assert.equal(terminals[index].input.size, 0);
  assert.equal(terminals[index].resizeHandlers.size, 0);
  assert.equal(observers[index].disconnectCount, 1);
}

const timeout = { timeout: 5000 };

test('aborting font wait leaves no terminal or abort listener', timeout, async (t) => {
  const state = createFixture(t, { waitForFonts: true });
  const controller = new AbortController();
  const reason = new Error('initialization canceled');
  const pending = mountDashboardTerminal(state.root, () => assert.fail('must not create a dashboard'), {
    signal: controller.signal,
  });
  await state.fontsAccessed.promise;
  controller.abort(reason);
  await assert.rejects(pending, (cause) => cause === reason);
  assert.deepEqual(getEventListeners(controller.signal, 'abort'), []);
  state.fontsReady.resolve();
  await setImmediate();
  assert.equal(state.terminals.length, 0);
  assert.equal(state.root.childElementCount, 0);
});

test('pre-frame rejection and cancellation clean up their hosts', timeout, async (t) => {
  const state = createFixture(t);
  const first = new AbortController();
  const second = new AbortController();
  const onExit = () => assert.fail('never publish an exit event after cancellation or failed initialization');
  const pending = mountDashboardTerminal(state.root, () => null, { signal: first.signal, onExit });
  const secondMount = mountDashboardTerminal(state.root, () => null, { signal: second.signal, onExit });
  const [firstApp, secondApp] = await Promise.all([state.appAt(0), state.appAt(1)]);
  first.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assertDisposed(state, 0);
  assert.equal(state.root.childElementCount, 1);
  assert.equal(state.terminals[1].textarea.isConnected, true);
  const startupError = new Error('failed before first frame');
  secondApp.exit.reject(startupError);
  await assert.rejects(secondMount, (cause) => cause === startupError);
  firstApp.initial.resolve();
  firstApp.exit.reject(new Error('stale Ink exit'));
  secondApp.initial.resolve();
  assertDisposed(state, 1);
  assert.equal(state.root.childElementCount, 0);
});

test('late Ink failure drains output and tears down the bridge', timeout, async (t) => {
  const state = createFixture(t);
  const controller = new AbortController();
  const stopped = Promise.withResolvers();
  const pending = mountDashboardTerminal(state.root, () => null, {
    signal: controller.signal,
    onExit: stopped.resolve,
  });
  const app = await state.appAt(0);
  app.initial.resolve();
  const terminal = await pending;
  terminal.focus();
  assert.equal(document.activeElement, state.terminals[0].textarea);
  state.dimensions = { cols: 68, rows: 33 };
  const resizes = [];
  app.options.stdout.on('resize', () => resizes.push(app.options.stdout.getWindowSize()));
  state.observers[0].notify();
  assert.deepEqual(resizes, [[68, 33]]);
  const drained = Promise.withResolvers();
  state.terminals[0].pauseWrites = true;
  app.options.stdout.write('pending frame', drained.resolve);
  const failure = new Error('Ink stopped later');
  app.exit.reject(failure);
  assert.deepEqual(await stopped.promise, { status: 'error', cause: failure });
  await drained.promise;
  assertDisposed(state, 0);
  assert.deepEqual(getEventListeners(controller.signal, 'abort'), []);
  assert.equal(state.root.childElementCount, 0);
  state.dimensions = { cols: 90, rows: 50 };
  state.observers[0].notify();
  assert.deepEqual(resizes, [[68, 33]]);
  terminal.focus();
  terminal.sendInput('q');
  terminal.dispose();
  assertDisposed(state, 0);
  assert.equal(state.terminals[0].focusCount, 1);
});

test('normal exit cleans up, even before the first frame', timeout, async (t) => {
  const state = createFixture(t);
  const stopped = Promise.withResolvers();
  const first = mountDashboardTerminal(state.root, () => null, { onExit: stopped.resolve });
  const app = await state.appAt(0);
  app.initial.resolve();
  assert.ok(await first);
  app.exit.resolve();
  assert.deepEqual(await stopped.promise, { status: 'ended' });
  assertDisposed(state, 0);
  let earlyExit;
  const early = mountDashboardTerminal(state.root, () => null, {
    onExit: (exit) => {
      earlyExit = exit;
    },
  });
  const earlyApp = await state.appAt(1);
  earlyApp.exit.resolve();
  assert.equal(await early, undefined);
  assert.deepEqual(earlyExit, { status: 'ended' });
  assertDisposed(state, 1);
});

test('demo shows late errors and ignores stale mounts on reset or unmount', timeout, async (t) => {
  const state = createFixture(t);
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { RouterProvider } = await import('@tanstack/react-router');
  const { TuiDemo } = await vite.ssrLoadModule('/src/components/demo/TuiDemo.tsx');
  const router = await createComponentRouter(React.createElement(TuiDemo), { initialEntries: ['/demo'] });
  const root = createRoot(state.root);
  const button = (label) => [...state.root.querySelectorAll('button')].find((entry) => entry.textContent === label);
  const key = () => state.root.querySelector('[aria-label="Send Down arrow to terminal"]');
  const click = (label) => React.act(async () => button(label).click());
  let unmounted = false;
  try {
    await React.act(async () => root.render(React.createElement(RouterProvider, { router })));
    const first = await state.appAt(0);
    assert.equal(button('Focus terminal').disabled, true);
    await click('Reset demo');
    const second = await state.appAt(1);
    assertDisposed(state, 0);
    await React.act(async () => {
      first.initial.resolve();
      first.exit.reject(new Error('stale initialization'));
    });
    assert.match(state.root.textContent, /Starting terminal/);
    assert.equal(button('Focus terminal').disabled, true);

    await React.act(async () => second.initial.resolve());
    assert.equal(button('Focus terminal').disabled, false);
    assert.equal(key().disabled, false);
    await React.act(async () => second.exit.reject(new Error('late Ink exception')));
    const alert = state.root.querySelector('[role="alert"]');
    assert.match(alert.textContent, /The terminal stopped/);
    assert.match(alert.textContent, /late Ink exception/);
    assert.equal(button('Focus terminal').disabled, true);
    assert.equal(key().disabled, true);
    assert.equal(state.root.querySelector('textarea'), null);
    assertDisposed(state, 1);

    await click('Try again');
    const third = await state.appAt(2);
    await React.act(async () => third.initial.resolve());
    assert.equal(key().disabled, false);
    await React.act(async () => third.element.props.onFinish(true));
    assert.match(state.root.querySelector('[role="status"]').textContent, /Session ended/);
    assertDisposed(state, 2);

    await click('Restart terminal');
    const fourth = await state.appAt(3);
    await React.act(async () => root.unmount());
    unmounted = true;
    fourth.initial.resolve();
    fourth.exit.reject(new Error('stale after unmount'));
    assertDisposed(state, 3);
    assert.equal(state.root.childElementCount, 0);
  } finally {
    if (!unmounted) await React.act(async () => root.unmount());
  }
});
