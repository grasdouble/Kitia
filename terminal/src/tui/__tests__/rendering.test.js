'use strict';

const assert = require('node:assert/strict');
const React = require('react');
const { test } = require('node:test');

const { renderTerminal } = require('./render-terminal.js');

test('section tabs stay clipped when there is no room for border corners', async () => {
  const { Controls } = await import('../controls.mts');
  const regions = [];
  const controls = React.createElement(Controls, {
    columns: 3,
    part: 'tabs',
    section: 'inventory',
    sectionCounts: { inventory: 1, browse: 2, catalogs: 3 },
    focus: 'tabs',
    query: '',
    searchActive: false,
    filters: [],
    actions: [],
    mouse: { replace: (_owner, next) => regions.push(...next) },
  });
  const frame = await renderTerminal(controls, { columns: 3 });
  const renderedRows = frame.trimEnd().split('\n');
  assert.equal(renderedRows.length, 9, 'three tabs retain top, text, and underline rows');
  assert.ok(
    renderedRows.every((row) => row.length <= 1),
    'the clipped tab fallback never draws beyond the one-cell content width',
  );
  assert.equal(regions.length, 3, 'all three sections retain their hit regions');
  assert.ok(
    regions.every(({ left, right }) => left === 2 && right === 2),
    'tiny-width hit regions stay within the terminal columns',
  );
});
test('update confirmation distinguishes GH-backed skills and other resources', async () => {
  const { confirmationModal } = await import('../features/resources/modals.mts');
  const base = {
    catalog: 'Test',
    id: 'update-me',
    scope: 'user',
    status: 'update',
    managed: true,
    source_repository: 'example/repo',
  };
  const confirmationText = (resource) =>
    confirmationModal({
      confirmation: { action: 'update', resource },
      selectedButton: 1,
      stage: 1,
      columns: 120,
    })
      .lines.map(({ bodyText, text }) => bodyText || text)
      .join(' ');
  const ghText = confirmationText({ ...base, kind: 'skill' });
  assert.ok(ghText.includes('first gh skill install runs without --force'));
  assert.ok(ghText.includes('If GH says overwrite requires --force, Kitia asks before retrying'));
  const ghRetry = confirmationModal({
    confirmation: {
      action: 'update',
      resource: { ...base, kind: 'skill' },
      forceRetry: true,
      ghForceRetry: true,
      ghForceAgent: 'standard',
      conflict: {
        category: 'github-force-required',
        paths: [],
        message: 'GitHub CLI says the skill already exists and requires --force.',
      },
    },
    selectedButton: 0,
    stage: 1,
    columns: 120,
  });
  const ghRetryText = ghRetry.lines.map(({ bodyText, text }) => bodyText || text).join(' ');
  assert.ok(ghRetryText.includes('GH REQUESTS OVERWRITE'));
  assert.ok(ghRetryText.includes('requires --force'));
  assert.ok(ghRetryText.includes('for standard'));
  assert.ok(ghRetryText.includes("Kitia's local-modification and untracked-content checks still apply"));
  const retryChoices = ghRetry.lines.find(({ options }) => options).options.map(({ label }) => label);
  assert.deepEqual(retryChoices, ['NO / CANCEL', 'YES, RETRY WITH --FORCE']);
  const agentText = confirmationText({ ...base, kind: 'agent' });
  assert.ok(agentText.includes('does not use gh --force'));
  assert.ok(!agentText.includes('gh skill install --force'));
});

test('update and uninstall confirmations show every tracked path for all resource kinds', async () => {
  const { confirmationModal } = await import('../features/resources/modals.mts');
  for (const [kind, paths] of Object.entries({
    skill: ['.agents/skills/review/SKILL.md', '.github/skills/review/SKILL.md', '.claude/skills/review/SKILL.md'],
    agent: ['.copilot/agents/review.agent.md', '.claude/agents/review.md'],
    instruction: ['.github/instructions/review.instructions.md', '.claude/rules/review.md'],
  })) {
    for (const action of ['update', 'uninstall']) {
      const resource = { kind, id: 'review', scope: kind === 'agent' ? 'user' : 'project', paths };
      const lines = confirmationModal({
        confirmation: { action, resource },
        selectedButton: 0,
        stage: 1,
        columns: 80,
      }).lines.map(({ bodyText }) => bodyText);
      assert.ok(lines.includes('Tracked paths:'));
      assert.deepEqual(
        lines.filter((line) => line?.startsWith('• ')),
        paths.map((path) => `• ${path}`),
      );
    }
  }
});
