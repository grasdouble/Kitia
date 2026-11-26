'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createSourceIndex } = require('../discovery.ts');
const { writeInstallPlan } = require('../../installations/files.ts');
const { installSourceFileResource } = require('../../installations/mutations.ts');
const { validateSourceConfiguration } = require('../model.ts');
const { setupTemporaryDirectory, createSource } = require('../../../../test/fixtures/source-catalog-fixtures.js');

const makeTemporaryDirectory = setupTemporaryDirectory();

test('Basic source indexing discovers categorized skills, agents, and instructions', () => {
  const temporary = makeTemporaryDirectory('kitia-categorized-source-');
  const repository = 'https://github.com/example/categorized';
  const source = createSource(temporary, 'categorized', repository);
  const skill = path.join(source, 'skills', 'engineering', 'research');
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(
    path.join(skill, 'SKILL.md'),
    [
      '---',
      'name: research',
      'description: Research sources: follow first-party references.',
      '---',
      '',
      'Synthetic categorized skill.',
    ].join('\n'),
  );
  const agent = path.join(source, 'agents', 'engineering', 'release.agent.md');
  const friendlyNamedAgent = path.join(source, 'agents', 'accessibility-runtime-tester.agent.md');
  const instruction = path.join(source, '.github', 'instructions', 'checklist.instructions.md');
  fs.mkdirSync(path.dirname(agent), { recursive: true });
  fs.mkdirSync(path.dirname(instruction), { recursive: true });
  fs.writeFileSync(agent, ['---', 'name: release', 'description: Release agent.', '---', '', 'Agent body.'].join('\n'));
  fs.writeFileSync(
    friendlyNamedAgent,
    ['---', 'name: Accessibility Runtime Tester', '---', '', 'Accessibility agent.'].join('\n'),
  );
  fs.writeFileSync(
    instruction,
    [
      '---',
      'name: checklist',
      'description: Review checklist.',
      'applyTo: src/**',
      '---',
      '',
      'Instruction body.',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(source, 'agents', 'README.md'), 'Not an agent resource.');
  const globalInstruction = path.join(source, 'instructions', 'global-guidance.md');
  fs.mkdirSync(path.dirname(globalInstruction), { recursive: true });
  fs.writeFileSync(globalInstruction, '# Global guidance\nApply this guidance across the repository.\n');
  execFileSync('git', ['-C', source, 'add', '.']);
  execFileSync('git', [
    '-C',
    source,
    '-c',
    'user.name=Catalog fixtures',
    '-c',
    'user.email=fixtures@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '-m',
    'Add categorized skill, agent and instructions',
  ]);

  const catalog = createSourceIndex(repository, 'categorized', source);
  assert.equal(catalog.resources.find((entry) => entry.id === 'research').source_path, 'skills/engineering/research');
  assert.equal(
    catalog.resources.find((entry) => entry.id === 'research').description,
    'Research sources: follow first-party references.',
  );
  assert.deepEqual(catalog.resources.map(({ kind, id }) => `${kind}:${id}`).sort(), [
    'agent:accessibility-runtime-tester',
    'agent:release',
    'instruction:checklist',
    'instruction:global-guidance',
    'skill:demo-skill',
    'skill:research',
  ]);
  assert.equal(
    catalog.resources.find((entry) => entry.id === 'release').source_path,
    'agents/engineering/release.agent.md',
  );
  assert.equal(
    catalog.resources.find((entry) => entry.id === 'accessibility-runtime-tester').description,
    'Accessibility agent.',
  );
  const scopedInstruction = catalog.resources.find((entry) => entry.id === 'checklist');
  assert.equal(scopedInstruction.source_path, '.github/instructions/checklist.instructions.md');
  assert.deepEqual(scopedInstruction.apply_to, ['src/**']);
  const globalResource = catalog.resources.find((entry) => entry.id === 'global-guidance');
  assert.equal(globalResource.source_path, 'instructions/global-guidance.md');
  assert.deepEqual(globalResource.apply_to, ['**']);
  assert.equal(
    catalog.resources.some(({ id }) => id === 'readme'),
    false,
  );
});

test('custom catalog mappings index explicit paths and default unscoped instructions globally', () => {
  const temporary = makeTemporaryDirectory('kitia-custom-source-');
  const repository = 'https://github.com/example/custom';
  const source = createSource(temporary, 'custom', repository);
  const skill = path.join(source, 'custom-skills', 'workflow', 'review');
  const agent = path.join(source, 'specialists', 'release.agent.md');
  const instruction = path.join(source, 'policies', 'checklist.instructions.md');
  fs.mkdirSync(skill, { recursive: true });
  fs.mkdirSync(path.dirname(agent), { recursive: true });
  fs.mkdirSync(path.dirname(instruction), { recursive: true });
  fs.writeFileSync(
    path.join(skill, 'SKILL.md'),
    ['---', 'name: review', 'description: Review changes.', '---', '', 'Skill body.'].join('\n'),
  );
  fs.writeFileSync(agent, ['---', 'name: release', 'description: Release agent.', '---', '', 'Agent body.'].join('\n'));
  fs.writeFileSync(
    instruction,
    [
      '---',
      'name: checklist',
      'description: Review checklist.',
      'apply_to:',
      '  - src/**',
      '  - tests/**',
      '---',
      '',
      'Instruction body.',
    ].join('\n'),
  );
  execFileSync('git', ['-C', source, 'add', '.']);
  execFileSync('git', [
    '-C',
    source,
    '-c',
    'user.name=Catalog fixtures',
    '-c',
    'user.email=fixtures@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '-m',
    'Add custom resource paths',
  ]);

  const configuration = validateSourceConfiguration({
    catalog_version: 1,
    sources: [
      {
        name: 'custom',
        repository,
        mode: 'custom',
        entries: [
          { kind: 'skill', path: 'custom-skills/workflow/review' },
          { kind: 'agent', path: 'specialists/release.agent.md' },
          { kind: 'instruction', path: 'policies/checklist.instructions.md' },
        ],
      },
    ],
  })[0];
  assert.deepEqual(
    configuration.entries.map(({ kind, id }) => [kind, id]),
    [
      ['skill', undefined],
      ['agent', 'release'],
      ['instruction', 'checklist'],
    ],
  );
  const catalog = createSourceIndex(repository, 'custom', source, configuration);
  assert.deepEqual(catalog.resources.map(({ kind, id }) => `${kind}:${id}`).sort(), [
    'agent:release',
    'instruction:checklist',
    'skill:review',
  ]);
  assert.equal(catalog.resources.find(({ kind }) => kind === 'skill').source_path, 'custom-skills/workflow/review');
  assert.deepEqual(catalog.resources.find(({ kind }) => kind === 'instruction').apply_to, ['src/**', 'tests/**']);
  assert.equal(
    catalog.resources.some(({ id }) => id === 'demo-skill'),
    false,
  );
  const target = path.join(temporary, 'target');
  fs.mkdirSync(target);
  const fileActions = [];
  const agentResource = catalog.resources.find(({ kind }) => kind === 'agent');
  assert.deepEqual(
    installSourceFileResource({ ...agentResource, catalog: 'custom' }, target, ['claude', 'copilot'], {
      dryRun: true,
      onAction: (action) => fileActions.push(action),
    }),
    ['.claude/agents/release.md', '.github/agents/release.agent.md'],
  );
  const instructionResource = catalog.resources.find(({ kind }) => kind === 'instruction');
  assert.deepEqual(
    installSourceFileResource(
      {
        ...instructionResource,
        catalog: 'custom',
      },
      target,
      ['claude', 'copilot'],
      {
        dryRun: true,
        onAction: (action) => fileActions.push(action),
      },
    ),
    ['.claude/rules/checklist.md', '.github/instructions/checklist.instructions.md'],
  );
  assert.deepEqual(
    fileActions.map(({ path: relativePath }) => relativePath),
    [
      '.claude/agents/release.md',
      '.github/agents/release.agent.md',
      '.claude/rules/checklist.md',
      '.github/instructions/checklist.instructions.md',
    ],
  );

  const firstPath = path.join(target, '.claude/agents/release.md');
  const secondPath = path.join(target, '.github/agents/release.agent.md');
  fs.mkdirSync(path.dirname(firstPath), { recursive: true });
  fs.mkdirSync(path.dirname(secondPath), { recursive: true });
  fs.writeFileSync(firstPath, 'existing claude agent\n');
  fs.writeFileSync(secondPath, 'existing copilot agent\n');
  const originalRename = fs.renameSync;
  let renameCount = 0;
  fs.renameSync = (...args) => {
    renameCount += 1;
    if (renameCount === 3) throw new Error('injected third-file write failure');
    return originalRename(...args);
  };
  const thirdPath = path.join(target, '.claude/rules/checklist.md');
  fs.mkdirSync(path.dirname(thirdPath), { recursive: true });
  fs.writeFileSync(thirdPath, 'existing instruction\n');
  try {
    const plan = new Map([
      ['.claude/agents/release.md', { content: Buffer.from('new claude agent\n'), executable: false }],
      ['.claude/rules/checklist.md', { content: Buffer.from('new instruction\n'), executable: false }],
      ['.github/agents/release.agent.md', { content: Buffer.from('new copilot agent\n'), executable: false }],
    ]);
    assert.throws(() => writeInstallPlan(plan, target, { force: true }), /injected third-file write failure/);
  } finally {
    fs.renameSync = originalRename;
  }
  assert.equal(fs.readFileSync(firstPath, 'utf8'), 'existing claude agent\n');
  assert.equal(fs.readFileSync(secondPath, 'utf8'), 'existing copilot agent\n');
  assert.equal(fs.readFileSync(thirdPath, 'utf8'), 'existing instruction\n');
  assert.equal(fs.existsSync(path.join(target, '.agents/kitia-lock.json')), false);
  assert.throws(
    () =>
      validateSourceConfiguration({
        catalog_version: 1,
        sources: [
          {
            name: 'unsafe',
            repository: 'https://github.com/example/unsafe',
            mode: 'custom',
            entries: [{ kind: 'agent', path: '../escape.agent.md' }],
          },
        ],
      }),
    /safe repository-relative path/,
  );
  fs.writeFileSync(instruction, '# Checklist without an explicit scope\n');
  const unscopedCatalog = createSourceIndex(repository, 'custom', source, configuration);
  assert.deepEqual(unscopedCatalog.resources.find(({ kind }) => kind === 'instruction').apply_to, ['**']);
  fs.writeFileSync(instruction, '---\napply_to: []\n---\n\nInvalid policy.\n');
  assert.throws(
    () => createSourceIndex(repository, 'custom', source, configuration),
    /example\/custom:policies\/checklist\.instructions\.md must define a non-empty/,
  );
});

test('custom catalog directory mappings discover nested skills, agents, and instructions', () => {
  const temporary = makeTemporaryDirectory('kitia-custom-directories-');
  const repository = 'https://github.com/example/custom-directories';
  const source = createSource(temporary, 'custom-directories', repository);
  const writeMarkdown = (relativePath, lines) => {
    const file = path.join(source, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, lines.join('\n'));
  };
  writeMarkdown('custom/skills/review/SKILL.md', [
    '---',
    'name: review',
    'description: Review changes.',
    '---',
    '',
    'Review skill.',
  ]);
  writeMarkdown('custom/skills/testing/SKILL.md', [
    '---',
    'name: testing',
    'description: Test changes.',
    '---',
    '',
    'Testing skill.',
  ]);
  writeMarkdown('custom/agents/release.agent.md', [
    '---',
    'name: release',
    'description: Release agent.',
    '---',
    '',
    'Release agent.',
  ]);
  writeMarkdown('custom/agents/security/security-review.agent.md', [
    '---',
    'name: security-review',
    'description: Security review agent.',
    '---',
    '',
    'Review agent.',
  ]);
  writeMarkdown('custom/instructions/security.instructions.md', [
    '---',
    'description: Security policy.',
    'apply_to: src/**',
    '---',
    '',
    'Security instructions.',
  ]);
  writeMarkdown('custom/instructions/testing/note.md', [
    '---',
    'description: Test policy.',
    'apply_to: tests/**',
    '---',
    '',
    'Test instructions.',
  ]);
  execFileSync('git', ['-C', source, 'add', '.']);
  execFileSync('git', [
    '-C',
    source,
    '-c',
    'user.name=Catalog fixtures',
    '-c',
    'user.email=fixtures@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '-m',
    'Add custom resource directories',
  ]);
  const configuration = validateSourceConfiguration({
    catalog_version: 1,
    sources: [
      {
        name: 'custom-directories',
        repository,
        mode: 'custom',
        entries: [
          { kind: 'skill', path: 'custom/skills/' },
          { kind: 'agent', path: 'custom/agents' },
          { kind: 'instruction', path: 'custom/instructions' },
        ],
      },
    ],
  })[0];
  assert.deepEqual(
    configuration.entries.map(({ path: sourcePath }) => sourcePath),
    ['custom/skills', 'custom/agents', 'custom/instructions'],
  );
  const catalog = createSourceIndex(repository, 'custom-directories', source, configuration);
  assert.deepEqual(catalog.resources.map(({ kind, id }) => `${kind}:${id}`).sort(), [
    'agent:release',
    'agent:security-review',
    'instruction:note',
    'instruction:security',
    'skill:review',
    'skill:testing',
  ]);
  assert.equal(catalog.resources.find(({ id }) => id === 'testing').source_path, 'custom/skills/testing');
});
