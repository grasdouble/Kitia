import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const vite = await createServer({
  configFile: path.join(projectRoot, 'web/vite.config.ts'),
  logLevel: 'silent',
  server: { middlewareMode: true },
  appType: 'custom',
});
after(() => vite.close());
const { scrollToSection } = await vite.ssrLoadModule('/src/sectionScrolling.ts');

function scrollFixture({ reducedMotion = false, targetTop = 2500 } = {}) {
  const dom = new JSDOM('<!doctype html><html style="scroll-padding-top:88px"><body><section style="scroll-margin-top:32px"></section></body></html>');
  const previous = new Map(['window', 'document'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document })) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  let y = 100;
  let nextId = 1;
  const frames = new Map();
  Object.defineProperty(window, 'scrollY', { get: () => y });
  Object.defineProperty(window, 'innerHeight', { value: 1000 });
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 4000 });
  window.matchMedia = () => ({ matches: reducedMotion });
  window.scrollTo = ({ top }) => { y = top; };
  window.requestAnimationFrame = (callback) => { const id = nextId++; frames.set(id, callback); return id; };
  window.cancelAnimationFrame = (id) => frames.delete(id);
  const target = document.querySelector('section');
  target.getBoundingClientRect = () => new dom.window.DOMRect(0, targetTop - y, 800, 400);
  return {
    target,
    get position() { return y; },
    advance(timestamp) {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(timestamp);
    },
    interrupt(event) { window.dispatchEvent(new dom.window.Event(event)); },
    restore() {
      dom.window.close();
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

test('section scrolling advances over time, eases at arrival, and respects sticky offsets', () => {
  const fixture = scrollFixture();
  const cancel = scrollToSection(fixture.target);
  try {
    assert.equal(fixture.position, 100, 'a click must not jump straight to its destination');
    fixture.advance(0);
    fixture.advance(200);
    const early = fixture.position;
    fixture.advance(400);
    const middle = fixture.position;
    fixture.advance(600);
    const late = fixture.position;
    fixture.advance(800);
    assert.ok(100 < early && early < middle && middle < late && late < fixture.position);
    assert.ok(fixture.position - late < late - middle, 'the animation slows toward arrival');
    assert.equal(fixture.position, 2380, 'the destination accounts for both header padding and section margin');
  } finally { cancel(); fixture.restore(); }
});

test('reduced motion jumps immediately and destinations cannot exceed the document boundary', () => {
  const fixture = scrollFixture({ reducedMotion: true, targetTop: 3700 });
  const cancel = scrollToSection(fixture.target);
  try {
    assert.equal(fixture.position, 3000);
    fixture.advance(0);
    fixture.advance(800);
    assert.equal(fixture.position, 3000);
  } finally { cancel(); fixture.restore(); }
});

test('manual input and navigation interrupt animation without later moving the viewport', () => {
  for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown', 'resize', 'popstate', 'hashchange']) {
    const fixture = scrollFixture();
    const cancel = scrollToSection(fixture.target);
    try {
      fixture.advance(0);
      fixture.advance(250);
      const interruptedAt = fixture.position;
      fixture.interrupt(event);
      fixture.advance(800);
      fixture.advance(1600);
      assert.equal(fixture.position, interruptedAt, `${event} must return scroll control to the user`);
    } finally { cancel(); fixture.restore(); }
  }
});

test('a replacement animation starts at the current position and cannot be overwritten by the old one', () => {
  const fixture = scrollFixture();
  const cancelFirst = scrollToSection(fixture.target);
  let cancelSecond;
  try {
    fixture.advance(0);
    fixture.advance(400);
    const replacementStart = fixture.position;
    cancelFirst();
    const previousTarget = document.createElement('section');
    previousTarget.getBoundingClientRect = () => new window.DOMRect(0, 800 - fixture.position, 800, 400);
    document.body.append(previousTarget);
    cancelSecond = scrollToSection(previousTarget);
    fixture.advance(400);
    assert.equal(fixture.position, replacementStart);
    fixture.advance(800);
    assert.ok(712 < fixture.position && fixture.position < replacementStart);
    fixture.advance(1200);
    fixture.advance(2000);
    assert.equal(fixture.position, 712);
  } finally { cancelFirst(); cancelSecond?.(); fixture.restore(); }
});
