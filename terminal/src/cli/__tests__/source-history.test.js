'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { formatSourceVersionTable } = require('../history.ts');
const { uniqueSourceVersionPrefixes, resolveSourceVersionPrefix } = require('../../core/resources/history.ts');

test('terminal source-history tables fit 80 and 120 columns while pipes retain full values', () => {
  const versions = [
    {
      sha: 'abcdef0123456789'.padEnd(40, '0'),
      date: '2025-04-03T12:13:14Z',
      subject: 'Add a concise feature.',
    },
    {
      sha: 'fedcba9876543210'.padEnd(40, '1'),
      date: '2025-04-04T12:13:14Z',
      subject: 'Document a significantly longer change description for the terminal table.',
    },
  ];
  for (const width of [80, 120]) {
    const [header, , ...rows] = formatSourceVersionTable(versions, width);
    const dateOffset = header.indexOf('DATE');
    const subjectOffset = header.indexOf('SUBJECT');
    assert.equal(header.length, width);
    for (const [index, row] of rows.entries()) {
      assert.equal(row.length, width);
      assert.equal(row.indexOf('2025-'), dateOffset);
      assert.equal(row.slice(subjectOffset, subjectOffset + 7), versions[index].subject.slice(0, 7));
    }
  }
  const piped = formatSourceVersionTable(versions)[3];
  assert.ok(piped.includes(versions[1].subject));
  assert.ok(piped.includes(versions[1].date));
});

test('source history displays unique, aligned prefixes when seven-character SHAs collide', () => {
  const versions = [
    { sha: `abcdef0${'0'.repeat(33)}`, date: '2025-04-03T12:13:14Z', subject: 'first' },
    { sha: `abcdef0${'1'.repeat(33)}`, date: '2025-04-03T12:13:14Z', subject: 'second' },
  ];
  const prefixes = uniqueSourceVersionPrefixes(versions);
  assert.deepEqual(prefixes, ['abcdef00', 'abcdef01']);
  for (const [index, prefix] of prefixes.entries()) {
    assert.equal(resolveSourceVersionPrefix(versions, prefix), versions[index].sha);
  }
  const [header, , ...rows] = formatSourceVersionTable(versions);
  const dateColumn = header.indexOf('DATE');
  assert.equal(rows[0].indexOf(versions[0].date), dateColumn);
  assert.equal(rows[1].indexOf(versions[1].date), dateColumn);
});
