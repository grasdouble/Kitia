'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
test('CLI catalog and installed-resource tables adapt to terminal width without truncating piped output', async () => {
  const { formatCatalogTable, renderInstalledResources, selectCatalogResource } = require('../dist/tui/terminal.js');
  const description = 'A complete description retained for piped terminal output.';
  const resources = [
    {
      catalog: 'platform-team',
      kind: 'skill',
      id: 'assistant-helper',
      status: 'stable',
      scope: 'project',
      description,
      source_repository: 'example/platform-team',
    },
    {
      catalog: 'personal-tools',
      kind: 'skill',
      id: 'assistant-helper',
      status: 'stable',
      scope: 'project',
      description,
      source_repository: 'example/personal-tools',
    },
  ];
  for (const columns of [80, 120]) {
    const terminal = { isTTY: true, columns };
    const catalogLines = formatCatalogTable(resources, terminal)
      .split('\n')
      .map((line) => line.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, ''));
    const catalogHeader = catalogLines[0];
    const catalogRow = catalogLines[1];
    assert.equal(catalogRow.slice(0, catalogHeader.indexOf('KIND')).trim(), resources[0].catalog);
    assert.equal(catalogHeader.indexOf('CATALOG'), catalogRow.indexOf(resources[0].catalog));
    assert.equal(catalogHeader.indexOf('KIND'), catalogRow.indexOf(resources[0].kind));
    assert.equal(catalogHeader.indexOf('ID'), catalogRow.indexOf(resources[0].id));
    assert.equal(catalogHeader.indexOf('STATUS'), catalogRow.indexOf(resources[0].status));
    assert.ok(catalogRow.length <= columns);
    assert.equal(catalogHeader.indexOf('DESCRIPTION'), catalogRow.indexOf(description.slice(0, 12)));

    const installed = renderInstalledResources(resources, terminal)
      .split('\n')
      .map((line) => line.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, ''));
    assert.equal(
      installed[1].slice(installed[0].indexOf('CATALOG'), installed[0].indexOf('KIND') - 1).trim(),
      resources[0].catalog,
    );
    assert.equal(installed[0].indexOf('CATALOG'), installed[1].indexOf(resources[0].catalog));
    assert.equal(installed[0].indexOf('ID'), installed[1].indexOf(resources[0].id));
    assert.equal(installed[0].indexOf('SCOPE'), installed[1].indexOf(resources[0].scope));
    assert.equal(installed[0].indexOf('KIND'), installed[1].indexOf(resources[0].kind));
    assert.equal(installed[0].indexOf('STATUS'), installed[1].indexOf(resources[0].status));
    assert.equal(installed[0].indexOf('DESCRIPTION'), installed[1].indexOf(description.slice(0, 12)));
    assert.ok(installed[1].length <= columns);
  }

  const nonInteractive = { isTTY: false };
  assert.ok(formatCatalogTable(resources.slice(0, 1), nonInteractive).includes(description));
  assert.ok(renderInstalledResources(resources.slice(0, 1), nonInteractive).includes(description));

  const { PassThrough } = require('node:stream');
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.isRaw = false;
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 120;
  output.rows = 30;
  let frame = '';
  output.on('data', (chunk) => {
    frame += chunk.toString();
  });
  const selected = selectCatalogResource(resources, input, output);
  input.emit('keypress', '\r', { name: 'return' });
  assert.equal(await selected, resources[0]);
  const plain = frame.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
  const [header, row] = plain
    .split(/\r?\n/)
    .filter((line) => line.includes('CATALOG') || line.includes(resources[0].catalog));
  assert.ok(header && row);
  assert.equal(header.indexOf('CATALOG'), row.indexOf(resources[0].catalog));
  assert.equal(header.indexOf('KIND'), row.indexOf(resources[0].kind));
  assert.equal(header.indexOf('ID'), row.indexOf(resources[0].id));
  assert.equal(header.indexOf('STATUS'), row.indexOf(resources[0].status));
  assert.equal(header.indexOf('DESCRIPTION'), row.indexOf(description.slice(0, 12)));
  input.destroy();
  output.destroy();
});
