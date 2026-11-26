'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runGhSkillAsync } = require('../gh-skill.ts');
const { setupTemporaryDirectory, nodeScriptSpawn } = require('../../../../test/fixtures/source-catalog-fixtures.js');

const makeTemporaryDirectory = setupTemporaryDirectory();

test('async GitHub skill runner relays sanitized output and bounds a hung process', async () => {
  const temporary = makeTemporaryDirectory('kitia-gh-timeout-');
  const script = path.join(temporary, 'gh.js');
  fs.writeFileSync(
    script,
    `process.stderr.write("\\u001b[31mDownloading token=verysecretcredential https://user:anothersecret@example.invalid/resource?api_key=querysecret\\u001b[0m\\n"); setTimeout(() => {}, 5000);\n`,
  );
  const progress = [];
  await assert.rejects(
    runGhSkillAsync(['skill', 'install'], temporary, {
      nonInteractive: true,
      timeout: 1500,
      onProgress: (message) => progress.push(message),
      spawnProcess: nodeScriptSpawn(script),
    }),
    (error) =>
      error.code === 'GH_TIMEOUT' &&
      /timed out/i.test(error.userMessage) &&
      /network connectivity/i.test(error.userMessage),
  );
  const output = progress.join('\n');
  assert.match(output, /gh stderr: Downloading token=\[REDACTED\]/i);
  assert.match(output, /https:\/\/\[REDACTED\]@example\.invalid\/resource\?\[REDACTED\]/);
  assert.doesNotMatch(output, /verysecretcredential|anothersecret|querysecret|\u001b|\x1b/);
  assert.ok(progress.some((message) => /timed out/i.test(message)));
});

test('async GitHub skill runner coalesces carriage-return status output', async () => {
  const temporary = makeTemporaryDirectory('kitia-gh-progress-coalesce-');
  const script = path.join(temporary, 'gh.js');
  fs.writeFileSync(
    script,
    [
      'let status = 0;',
      'const timer = setInterval(() => { process.stdout.write(`Status ${++status}\\r`); if (status === 40) { clearInterval(timer); process.stdout.write("Final status\\r"); process.exit(0); } }, 5);',
      '',
    ].join('\n'),
  );
  const progress = [];
  const result = await runGhSkillAsync(['skill', 'install'], temporary, {
    timeout: 3000,
    onProgress: (message) => progress.push(message),
    spawnProcess: nodeScriptSpawn(script),
  });
  assert.equal(result.status, 0);
  assert.ok(progress.length <= 4, `expected coalesced events, received ${progress.length}`);
  assert.equal(progress.at(-1), 'gh stdout: Final status');
});
