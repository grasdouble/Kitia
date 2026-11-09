import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';

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

test('changelog renders source versions with shareable links', async () => {
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { Changelog } = await vite.ssrLoadModule('/src/components/sections/Changelog.tsx');
  const source = await readFile(path.join(projectRoot, 'CHANGELOG.md'), 'utf8');
  const expectedVersions = [...source.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
  const markup = renderToStaticMarkup(React.createElement(Changelog));
  const renderedVersions = [...markup.matchAll(/<h2 id="release-([^"]+)">([^<]+)<\/h2>/g)].map((match) => match[2]);
  const linkedVersions = [...markup.matchAll(/href="#release-([^"]+)"/g)].map((match) => match[1]);
  const expectedDetails = [...source.matchAll(/^ {2,}- .+$/gm)].length;
  const renderedDocument = new JSDOM(markup);
  const renderedDetails = renderedDocument.window.document.querySelectorAll('main article ul ul > li').length;
  renderedDocument.window.close();

  assert.deepEqual(renderedVersions, expectedVersions);
  assert.deepEqual(linkedVersions, expectedVersions);
  assert.equal(renderedDetails, expectedDetails);
});
