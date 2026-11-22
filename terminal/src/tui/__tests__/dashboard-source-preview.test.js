'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { waitForDashboardFrame, selectedListRow } = require('./dashboard-frames.js');

test('preview starts with source files and keeps audit and tree pages separate', async () => {
  const { inspectionPageCount, inspectionPageView } = await import('../screens.mts');
  const resource = { catalog: 'AI-Kit', kind: 'skill', id: 'sample' };
  const firstFile = Array.from({ length: 80 }, (_, index) => `First file line ${index}`);
  const secondFile = ['Second file line 0', 'Second file line 1'];
  const tree = ['sample/', '├── references/', '│   └── second.md', '└── SKILL.md'];
  const audit = [
    'Audit coverage: 2/2 files analyzed; no files skipped.',
    '  No configured audit rules matched. This is not a safety guarantee.',
  ];
  const content = [
    ...tree,
    '',
    '── SKILL.md ──',
    '',
    ...firstFile,
    '',
    '── references/second.md ──',
    '',
    ...secondFile,
    ...audit,
  ].join('\n');
  const options = { action: 'preview', resource, content, columns: 90, rows: 40 };
  const sourceCount = inspectionPageCount(options);
  assert.equal(sourceCount, 5);
  const sourcePages = Array.from({ length: sourceCount }, (_, page) => inspectionPageView({ ...options, page }));
  assert.match(sourcePages[0].title, /^FILE SKILL\.md/);
  assert.equal(sourcePages[0].lines[0], firstFile[0]);
  assert.deepEqual(
    sourcePages.flatMap(({ lines }) => lines),
    [...firstFile, ...secondFile],
  );
  assert.equal(sourcePages.at(-1).title, 'FILE references/second.md');
  assert.deepEqual(inspectionPageView({ ...options, focus: 'source', page: 0 }), sourcePages[0]);
  assert.deepEqual(inspectionPageView({ ...options, page: -1 }), sourcePages[0]);
  assert.deepEqual(inspectionPageView({ ...options, page: sourceCount }), sourcePages.at(-1));
  for (const [focus, title, expected] of [
    ['audit', 'AUDIT REPORT', audit.map((line) => line.trim())],
    ['tree', 'SOURCE TREE', tree],
  ]) {
    const count = inspectionPageCount({ ...options, focus });
    const pages = Array.from({ length: count }, (_, page) => inspectionPageView({ ...options, focus, page }));
    assert.match(pages[0].title, new RegExp(`^${title}`));
    assert.deepEqual(
      pages.flatMap(({ lines }) => lines),
      expected,
    );
    assert.equal(pages[0].pageCount, count);
    assert.deepEqual(inspectionPageView({ ...options, focus, page: count }), pages.at(-1));
  }
});

for (const [kind, sourcePath] of [
  ['skill', 'skills/sample'],
  ['agent', 'agents/sample.agent.md'],
  ['instruction', 'instructions/sample.instructions.md'],
]) {
  test(`preview opens ${kind} content before its fallback tree and unavailable audit`, async () => {
    const { inspectionPageCount, inspectionPageView } = await import('../screens.mts');
    const options = {
      action: 'preview',
      resource: { catalog: 'sample', kind, id: 'sample', source_path: sourcePath },
      content: '# Pinned source\nRead the complete source before installing.',
      columns: 100,
      rows: 40,
      page: 0,
    };
    const source = inspectionPageView(options);
    assert.equal(source.lines[0], '# Pinned source');
    assert.match(source.title, /^FILE /);
    assert.equal(inspectionPageCount(options), 1);
    const tree = inspectionPageView({ ...options, focus: 'tree' });
    assert.equal(tree.title, 'SOURCE TREE');
    assert.deepEqual(tree.lines, ['sample/', `└── ${kind === 'skill' ? 'SKILL.md' : path.basename(sourcePath)}`]);
    const audit = inspectionPageView({ ...options, focus: 'audit' });
    assert.equal(audit.title, 'AUDIT REPORT');
    assert.equal(audit.lines.join(' '), 'Audit report unavailable; no result was returned.');
    assert.doesNotMatch(audit.lines.join(' '), /No configured audit rules matched|no files skipped|clean/i);
  });
}

function rawSourcePreview(resource, lines) {
  return [
    `id: ${resource.id}`,
    `description: Review repository changes.`,
    `catalog: ${resource.catalog}`,
    `source: ${resource.source_repository}/${resource.source_path}@${resource.source_ref}`,
    'license: MIT',
    `upstream: https://github.com/${resource.source_repository}/tree/${resource.source_ref}/${resource.source_path}`,
    '',
    ...lines,
  ].join('\n');
}

const previewMarkdownLines = [
  '',
  '---',
  'name: reviewer',
  '---',
  '',
  '# Review checklist',
  'Item|Status|Note',
  '----|-----|----',
  'Tests|pass|done',
  '',
  '| Item | Status |',
  '| ---- | ------ |',
  '| Docs | ready |',
  '',
  'Section title',
  '-------------',
  'Another section',
  '==============',
  '**Review carefully** and *keep emphasis* with [reference](https://example.com/review).',
  'Keep `inline code`, <angle brackets>, & ampersands, café, 漢字 and 🙂 literal.  ',
  '\tIndented source retains tabs and trailing spaces.  ',
  '```javascript',
  'const review = "approved";',
  '/* Preserve comment state',
  '   across source lines. */',
  '```',
  '~~~unknown-preview-language',
  'const unrecognized = "plain source";',
  '~~~',
  '---',
  '----',
  '***',
  '___',
  '-- important body text --',
  '── ordinary body text ──',
  '— ordinary body text —',
  '– ordinary body text –',
  '',
  '```markdown',
  '── references/checklist.md ──',
  '',
  'This exact declared header is a fenced example.',
  '```',
  '~~~markdown',
  '── scripts/tools/review.sh ──',
  '',
  'This other declared header is also a fenced example.',
  '~~~',
  '── missing.md ──',
  '',
  'An undeclared path is body text.',
  '── SKILL.md ──',
  '',
  'A repeated entrypoint is body text.',
  '',
  '',
];

for (const [kind, sourcePath] of [
  ['skill', 'skills/reviewer'],
  ['agent', 'agents/reviewer.agent.md'],
  ['instruction', 'instructions/reviewer.instructions.md'],
]) {
  test(`preview preserves Markdown and exact source page counts for ${kind}`, async () => {
    const { inspectionPageCount, inspectionPageView } = await import('../screens.mts');
    const resource = {
      catalog: 'sample',
      kind,
      id: 'reviewer',
      source_repository: 'org/repo',
      source_path: sourcePath,
      source_ref: 'a'.repeat(40),
    };
    const tree = [
      'reviewer/',
      '├── references/',
      '│   └── checklist.md',
      '├── scripts/',
      '│   └── tools/',
      '│       └── review.sh',
      '└── SKILL.md',
    ];
    const files =
      kind === 'skill'
        ? [
            { path: 'SKILL.md', lines: previewMarkdownLines },
            { path: 'references/checklist.md', lines: ['', '# Checklist', 'Keep every line.', ''] },
            {
              path: 'scripts/tools/review.sh',
              lines: ['#!/bin/sh', "printf 'review complete\\n'", '', ''],
            },
          ]
        : [
            {
              path: path.basename(sourcePath),
              lines: rawSourcePreview(resource, previewMarkdownLines).split('\n'),
            },
          ];
    const content =
      kind === 'skill'
        ? [
            ...tree,
            '',
            ...files.flatMap((file, index) => [...(index ? [''] : []), `── ${file.path} ──`, '', ...file.lines]),
            '',
          ].join('\n')
        : files[0].lines.join('\n');
    const options = { resource, content, columns: 240, rows: 100 };
    const count = inspectionPageCount(options);
    assert.equal(count, files.length, 'only real source files contribute pages');
    const pages = Array.from({ length: count }, (_, page) => inspectionPageView({ ...options, page }));
    assert.deepEqual(
      pages.map(({ title }) => title),
      files.map((file) => `FILE ${file.path}`),
    );
    assert.deepEqual(
      pages.map(({ lines }) => lines),
      files.map((file) => file.lines),
    );
    assert.ok(pages.every(({ pageCount }) => pageCount === files.length));
    const treePage = inspectionPageView({ ...options, focus: 'tree', page: 0 });
    assert.deepEqual(treePage.lines, kind === 'skill' ? tree : ['reviewer/', `└── ${path.basename(sourcePath)}`]);
  });
}

test('preview independently paginates complete long source, audit and tree content at adaptive sizes', async () => {
  const { inspectionPageCount, inspectionPageView } = await import('../screens.mts');
  const tree = [
    'sample/',
    '├── references/',
    ...Array.from({ length: 80 }, (_, index) => `│   ${index === 79 ? '└' : '├'}── file-${index}.md`),
    '└── SKILL.md',
  ];
  const source = Array.from({ length: 100 }, (_, index) => `Source line ${index}`);
  const audit = [
    'Audit coverage: 1/1 files analyzed; no files skipped.',
    ...Array.from({ length: 80 }, (_, index) => `  WARNING f.md:${index + 1} [PROMPT_OVERRIDE] Finding ${index}`),
  ];
  const options = {
    action: 'preview',
    resource: { catalog: 'sample', kind: 'skill', id: 'sample' },
    content: [...tree, '', '── SKILL.md ──', '', ...source, ...audit].join('\n'),
  };
  for (const [columns, rows] of [
    [120, 45],
    [72, 40],
    [120, 18],
    [60, 24],
    [56, 12],
    [120, 8],
  ]) {
    for (const [focus, expected] of [
      ['source', source],
      ['audit', audit],
      ['tree', tree],
    ]) {
      const viewport = { ...options, columns, rows, focus };
      const count = inspectionPageCount(viewport);
      assert.ok(count > 1, `${focus} has multiple pages at ${columns}x${rows}`);
      const pages = Array.from({ length: count }, (_, page) => inspectionPageView({ ...viewport, page }));
      assert.deepEqual(
        pages
          .flatMap(({ lines }) => lines)
          .join('')
          .replace(/\s/g, ''),
        expected.join('').replace(/\s/g, ''),
        `${focus} retains every line at ${columns}x${rows}`,
      );
      assert.deepEqual(
        pages.map(({ page }) => page),
        Array.from({ length: count }, (_, page) => page),
      );
      assert.ok(pages.every(({ pageCount }) => pageCount === count));
    }
  }
  assert.ok(
    inspectionPageCount({ ...options, columns: 72, rows: 30 }) >
      inspectionPageCount({ ...options, columns: 72, rows: 45 }),
    'a shorter terminal uses more source pages',
  );
});

test('preview wraps highlighted source without changing whitespace, Unicode or logical-file state', async () => {
  const { inspectionPageCount, inspectionPageView } = await import('../screens.mts');
  const source = [
    '# Exact source',
    '**Emphasis** and [link](https://example.com/?a=1&b=2) with `inline code`.',
    '',
    '```javascript',
    '/* ' + 'comment continuation café 漢字 🙂 <>& '.repeat(70),
    'still inside the same comment */',
    'const message = `' + 'wrapped template content '.repeat(70),
    'template continuation`;',
    '```',
    '\tTrailing whitespace stays intact.  ',
    '',
    '~~~unsupported-preview-language',
    "const plain = '<>&';",
    '~~~',
    '',
  ];
  const resource = { catalog: 'sample', kind: 'skill', id: 'sample' };
  const content = ['sample/', '└── SKILL.md', '', '── SKILL.md ──', '', ...source, ''].join('\n');
  for (const [columns, rows] of [
    [72, 40],
    [60, 24],
  ]) {
    const options = { resource, content, columns, rows };
    const width = columns - 6;
    const expected = source.flatMap((line) => {
      if (line.length <= width) return [line];
      const characters = Array.from(line);
      return Array.from({ length: Math.ceil(characters.length / width) }, (_, index) =>
        characters.slice(index * width, (index + 1) * width).join(''),
      );
    });
    const count = inspectionPageCount(options);
    assert.ok(count > 2, 'multiline tokens cross source pages');
    const pages = Array.from({ length: count }, (_, page) => inspectionPageView({ ...options, page }));
    assert.deepEqual(
      pages.flatMap(({ lines }) => lines),
      expected,
      `source text and wrapping remain exact at ${columns}x${rows}`,
    );
    assert.ok(pages.every(({ lines }) => lines.every((line) => !line.includes('\u001b'))));
    assert.deepEqual(inspectionPageView({ ...options, focus: 'tree', page: 0 }).lines, ['sample/', '└── SKILL.md']);
    assert.equal(
      inspectionPageView({ ...options, focus: 'audit', page: 0 }).lines.join(' '),
      'Audit report unavailable; no result was returned.',
    );
  }
});

for (const [kind, columns, rows, hasAudit] of [
  ['skill', 120, 45, true],
  ['agent', 72, 40, true],
  ['instruction', 120, 18, true],
  ['instruction', 72, 40, false],
]) {
  test(`catalog preview independently navigates ${kind} panes at ${columns}x${rows}${hasAudit ? '' : ' without an audit'}`, async () => {
    const { PassThrough } = require('node:stream');
    const { runDashboard } = await import('../dashboard.mts');
    const { inspectionPageView } = await import('../screens.mts');
    const input = new PassThrough();
    input.isTTY = true;
    input.setRawMode = () => {};
    input.ref = () => {};
    input.unref = () => {};
    const output = new PassThrough();
    output.isTTY = true;
    output.columns = columns;
    output.rows = rows;
    let rendered = '';
    output.on('data', (chunk) => {
      rendered += chunk.toString();
    });
    const calls = [];
    const resource = {
      catalog: 'sample',
      kind,
      id: 'reviewer',
      source_repository: 'org/repo',
      source_ref: 'a'.repeat(40),
      source_path: kind === 'skill' ? 'skills/reviewer' : `${kind}s/reviewer.md`,
    };
    const sourceLines = [
      'Source marker 0',
      'Item|Status|Note',
      '----|-----|----',
      'Tests|pass|done',
      ...Array.from({ length: 99 }, (_, index) => `Source marker ${index + 1}`),
    ];
    const sourceOutput = [
      ...(kind === 'skill'
        ? [
            'reviewer/',
            '├── references/',
            ...Array.from({ length: 60 }, (_, index) => `│   ${index === 59 ? '└' : '├'}── reference-${index}.md`),
            '└── SKILL.md',
            '',
            '── SKILL.md ──',
            '',
            ...sourceLines,
          ]
        : rawSourcePreview(resource, sourceLines).split('\n')),
      ...(hasAudit
        ? [
            'Audit coverage: 1/1 files analyzed; no files skipped.',
            ...Array.from(
              { length: 60 },
              (_, index) =>
                `  WARNING ${kind === 'skill' ? 'SKILL.md' : resource.source_path}:${index + 1} [PROMPT_OVERRIDE] Audit marker ${index}`,
            ),
          ]
        : []),
    ].join('\n');
    const options = { action: 'preview', resource, content: sourceOutput, columns, rows };
    const done = runDashboard([], input, output, [], {
      catalogResources: [resource],
      execute: async (action) => {
        calls.push(action);
        return { code: 0, messages: [sourceOutput], resources: [], errors: [] };
      },
    });
    const press = (key, predicate, expected) => {
      const start = rendered.length;
      input.write(key);
      return waitForDashboardFrame(output, () => rendered, predicate, expected, start);
    };
    const navigate = (key, focus, page) => {
      const view = inspectionPageView({ ...options, focus, page });
      const label = { source: 'SOURCE', audit: 'AUDIT REPORT', tree: 'SOURCE TREE' }[focus];
      const pageLabel = `PAGE ${page + 1}/${view.pageCount}`;
      const content = view.lines.find((line) => line.trim());
      return press(
        key,
        (frame) =>
          frame.includes('SOURCE PREVIEW') &&
          (frame.includes(`› ${label} · ${pageLabel}`) || frame.includes(`› ${pageLabel} · ${label}`)) &&
          frame.includes(content),
        `${focus} preview page ${page + 1}`,
      );
    };
    try {
      const inventoryVisible = (frame) => frame.includes('INSTALLED RESOURCES');
      const browseVisible = (frame) => frame.includes('CATALOG RESOURCES');
      await waitForDashboardFrame(output, () => rendered, inventoryVisible, 'initial inventory before preview');
      await press('2', (frame) => browseVisible(frame) && selectedListRow(frame) === 'reviewer', 'Browse selection');
      const initial = await navigate('p', 'source', 0);
      assert.match(initial, /SOURCE PREVIEW/);
      assert.match(initial, new RegExp(`FILE ${kind === 'skill' ? 'SKILL\\.md' : 'reviewer\\.md'}`));
      if (kind === 'skill') assert.match(initial, /----\|-----\|----/);
      if (columns >= 120 && rows >= 40) {
        assert.match(initial, /AUDIT REPORT/);
        assert.match(initial, /SOURCE TREE/);
        assert.match(initial, /Audit coverage:/);
      } else {
        assert.doesNotMatch(initial, /AUDIT REPORT|SOURCE TREE/);
      }
      await navigate('\x1b[C', 'source', 1);
      const audit = await navigate('a', 'audit', 0);
      if (hasAudit) {
        assert.match(audit, /Audit coverage:/);
        await navigate('\x1b[C', 'audit', 1);
      } else {
        assert.match(audit.replace(/\s+/g, ' '), /Audit report unavailable; no result was returned\./);
        assert.doesNotMatch(audit, /No configured audit rules matched|no files skipped/);
      }
      const treePages = kind === 'skill' ? 2 : 1;
      await navigate('t', 'tree', 0);
      if (treePages > 1) await navigate('\x1b[C', 'tree', 1);
      await navigate('s', 'source', 1);
      await navigate('\x1b[D', 'source', 0);
      await navigate('a', 'audit', hasAudit ? 1 : 0);
      if (hasAudit) await navigate('\x1b[D', 'audit', 0);
      await navigate('t', 'tree', treePages - 1);
      if (treePages > 1) await navigate('\x1b[D', 'tree', 0);
      await navigate('\t', 'source', 0);
      assert.deepEqual(calls, ['preview']);
      await press(
        '\r',
        (frame) => browseVisible(frame) && !frame.includes('SOURCE PREVIEW'),
        'Browse after preview',
      );
      await press('\x1b', (frame) => inventoryVisible(frame) && !browseVisible(frame), 'Inventory after Browse');
      input.write('q');
      assert.equal(await done, true);
    } finally {
      input.destroy();
      await done.catch(() => {});
      output.destroy();
    }
  });
}
