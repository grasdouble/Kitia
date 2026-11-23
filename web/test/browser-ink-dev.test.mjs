import assert from 'node:assert/strict';
import { mkdtempDisposable } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createServer } from 'vite';

test('the browser EventEmitter works when initialized before Ink', async () => {
  await using cache = await mkdtempDisposable(join(tmpdir(), 'kitia-ink-vite-'));
  const vite = await createServer({
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    cacheDir: cache.path,
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: ['events'] },
    server: { middlewareMode: true, watch: null, ws: false },
  });
  try {
    const { default: EventEmitter } = await import(pathToFileURL(join(cache.path, 'deps/events.js')).href);
    const emitter = new EventEmitter();
    const messages = [];
    emitter.once('data', (message) => messages.push(message));
    emitter.emit('data', 'first');
    emitter.emit('data', 'second');
    assert.deepEqual(messages, ['first']);
  } finally {
    await vite.close();
  }
});
