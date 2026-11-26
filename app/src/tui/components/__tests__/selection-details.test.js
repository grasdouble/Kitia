'use strict';

const assert = require('node:assert/strict');
const React = require('react');
const { PassThrough } = require('node:stream');
const { test } = require('node:test');

test('SelectionDetails renders common hierarchy before screen-specific metadata', async () => {
  const { render } = await import('ink');
  const { SelectionDetails } = await import('../selection-details.mjs');
  const { detailField } = await import('../detail-fields.mjs');
  const details = SelectionDetails({
    kind: 'skill',
    id: 'sample-resource',
    description: 'A reusable sample description.',
    width: 80,
    kindColor: 'green',
    metadata: detailField('test-catalog', 'CATALOG', 'example', 80, Infinity),
  });
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 80;
  output.rows = 24;
  let frame = '';
  const write = output.write.bind(output);
  output.write = (chunk, ...args) => {
    frame += chunk.toString();
    return write(chunk, ...args);
  };
  let instance;
  const rendered = new Promise((resolve) => {
    instance = render(React.createElement(React.Fragment, null, ...details), {
      stdout: output,
      stderr: output,
      stdin: new PassThrough(),
      exitOnCtrlC: false,
      onRender: resolve,
    });
  });
  await rendered;
  instance.unmount();
  const text = frame.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
  assert.ok(text.indexOf('skill') < text.indexOf('sample-resource'));
  assert.ok(text.indexOf('sample-resource') < text.indexOf('A reusable sample description.'));
  assert.ok(text.indexOf('A reusable sample description.') < text.indexOf('CATALOG'));
  assert.ok(text.indexOf('CATALOG') < text.indexOf('example'));
});
