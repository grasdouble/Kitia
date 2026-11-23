'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach } = require('node:test');

function setupTemporaryDirectory() {
  let temporary;
  afterEach(() => {
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
    temporary = null;
  });
  return (prefix) => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    return temporary;
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function createSource(temporary, name, repository) {
  const source = path.join(temporary, name);
  const skill = path.join(source, 'skills', 'demo-skill');
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(
    path.join(skill, 'SKILL.md'),
    [
      '---',
      'name: demo-skill',
      'description: A generated source skill.',
      'license: MIT',
      '---',
      '',
      'Synthetic body that must not appear in the index.',
      '',
    ].join('\n'),
  );
  execFileSync('git', ['init', '--quiet', source]);
  execFileSync('git', ['-C', source, 'remote', 'add', 'origin', repository]);
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
    'Add synthetic skill',
  ]);
  return source;
}

const nodeScriptSpawn = (script) => (command, args, options) => {
  assert.equal(command, 'gh');
  return spawn(process.execPath, [script, ...args], options);
};

module.exports = { createSource, nodeScriptSpawn, setupTemporaryDirectory, writeJson };
