'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const Ajv = require('ajv');
const schema = require('../../../../schemas/catalog-lock-v1.schema.json');
const fixture = require('../../../../test/fixtures/inventory-v1-source-only.json');
const { CATALOG_PRESETS } = require('../../catalogs/presets.ts');
const { readInstallState, recordSourceInstallation } = require('../inventory.ts');
const { LOCK_PATH } = require('../model.ts');

const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);

function createTarget(t) {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'kitia-inventory-schema-'));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  return target;
}

test('v1 schema accepts the committed fixture and retains the fixed inventory identity', () => {
  assert.equal(validate(fixture), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...fixture, catalog: 'Anthropics' }), false);
});

test('v1 schema accepts inventory written for the Anthropics preset and a catalog display name', (t) => {
  const target = createTarget(t);
  const preset = CATALOG_PRESETS.find(({ command }) => command === 'anthropics');
  const catalogs = [
    { catalog: preset.catalogName, repository: new URL(preset.repository).pathname.slice(1), id: 'preset-skill' },
    { catalog: 'Team Playbook', repository: 'example/team-playbook', id: 'team-skill' },
  ];
  for (const { catalog, repository, id } of catalogs) {
    const sourcePath = `skills/${id}`;
    const sourceRef = 'b'.repeat(40);
    const installed = path.join(target, '.agents', 'skills', id, 'SKILL.md');
    fs.mkdirSync(path.dirname(installed), { recursive: true });
    fs.writeFileSync(
      installed,
      `---\nname: ${id}\ndescription: A fixture skill.\nmetadata:\n  github-repo: ${repository}\n  github-path: ${sourcePath}\n  github-pinned: ${sourceRef}\n---\nFixture body.\n`,
    );
    recordSourceInstallation(
      { catalog, kind: 'skill', id, source_repository: repository, source_path: sourcePath, source_ref: sourceRef },
      target,
      'github-copilot',
    );
  }
  const written = JSON.parse(fs.readFileSync(path.join(target, LOCK_PATH), 'utf8'));
  assert.deepEqual(Object.keys(written.sources), ['Anthropics', 'Team Playbook']);
  assert.equal(validate(written), true, JSON.stringify(validate.errors));
  assert.deepEqual(readInstallState(target), written);
});

test('v1 schema and the inventory reader agree on reserved names, whitespace, separators, and controls', (t) => {
  const target = createTarget(t);
  const lock = path.join(target, LOCK_PATH);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const names = [
    ['catalogSources', true],
    ['CATALOGSOURCES', true],
    ['Team\u2028Playbook', true],
    ['', false],
    [' Team', false],
    ['Team ', false],
    ['\u00a0Team', false],
    ['Team\u2028Playbook\u2029', false],
    ['Team/Playbook', false],
    ['Team\\Playbook', false],
    ['Team:Playbook', false],
    ['Team\u0000Playbook', false],
    ['Team\u001fPlaybook', false],
    ['Team\u007fPlaybook', false],
    ['Team\u009fPlaybook', false],
  ];
  for (const [name, valid] of names) {
    const inventory = { ...fixture, sources: { [name]: fixture.sources['team-alpha'] } };
    const label = JSON.stringify(name);
    const matches = validate(inventory);
    assert.equal(matches, valid, `${label}: ${JSON.stringify(validate.errors)}`);
    fs.writeFileSync(lock, JSON.stringify(inventory));
    if (valid) assert.deepEqual(readInstallState(target), inventory, label);
    else assert.throws(() => readInstallState(target), /Invalid installation state/, label);
  }
});
