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

  assert.deepEqual(renderedVersions, expectedVersions);
  assert.deepEqual(linkedVersions, expectedVersions);
});

test('changelog preserves grouped details and legacy release notes', async () => {
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { Changelog } = await vite.ssrLoadModule('/src/components/sections/Changelog.tsx');
  const dom = new JSDOM(renderToStaticMarkup(React.createElement(Changelog)));
  try {
    const document = dom.window.document;
    const release = document.querySelector('article[aria-labelledby="release-2.0.0"]');
    const sections = [...release.querySelectorAll('section')];
    assert.deepEqual(sections.map((section) => section.querySelector('h3').textContent), ['Major Changes', 'Minor Changes']);

    for (const section of sections) {
      const groups = [...section.querySelectorAll(':scope > ul > li > ul > li')];
      assert.deepEqual(groups.map((group) => group.querySelector(':scope > strong')?.textContent), ['User-Facing', 'Technical']);
      assert.equal(section.textContent.includes('**'), false);
    }

    const majorGroups = sections[0].querySelectorAll(':scope > ul > li > ul > li');
    assert.deepEqual([...majorGroups[0].querySelectorAll(':scope > ul > li')].map((item) => item.textContent), [
      'Require Node.js 26 or newer; Node.js 22 and 24 are no longer supported.',
    ]);
    assert.deepEqual([...majorGroups[1].querySelectorAll(':scope > ul > li')].map((item) => item.textContent), [
      'Align continuous integration with Node.js 26.',
    ]);
    const minorGroups = sections[1].querySelectorAll(':scope > ul > li > ul > li');
    assert.ok([...minorGroups[0].querySelectorAll(':scope > ul > li')].some((item) =>
      item.textContent === 'Replace a tracked source resource with a selected commit through existing update safeguards in the CLI and dashboard.'));
    assert.deepEqual([...minorGroups[1].querySelectorAll(':scope > ul > li')].map((item) => item.textContent), [
      'Keep all source catalog, file-resource, and dashboard flows on shared lifecycle and update safeguards.',
    ]);
    assert.equal(release.querySelector('a[aria-label="View commit 47cd156 on GitHub"]').getAttribute('href'),
      'https://github.com/grasdouble/Kitia/commit/47cd156');

    const legacyChange = document.querySelector('article[aria-labelledby="release-1.1.1"] section > ul > li');
    assert.deepEqual([...legacyChange.querySelectorAll(':scope > ul > li')].map((item) => item.textContent), [
      'Measure site visits and navigation actions with Google Analytics.',
    ]);
    assert.equal(legacyChange.querySelector('strong'), null);
  } finally {
    dom.window.close();
  }
});
