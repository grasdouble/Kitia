'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createInterface } = require('node:readline');
const { test } = require('node:test');

const executable = process.env.KITIA_TEST_WEB_EXECUTABLE || path.resolve(__dirname, '../dist/kitia.js');

function request(url, headers, method = 'GET') {
  return new Promise((resolve, reject) => {
    const client = http.request(url, { method, headers, agent: false }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
      response.on('error', reject);
    });
    client.on('error', reject);
    client.end();
  });
}

test(
  'the web command serves only the launch project and user inventory to its session',
  { timeout: 10_000 },
  async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'kitia-web-test-'));
    const project = path.join(temporary, 'project');
    const user = path.join(temporary, 'user');
    const config = path.join(temporary, 'config');
    const projectAgents = path.join(project, '.claude', 'agents');
    const userAgents = path.join(user, '.claude', 'agents');
    for (const directory of [projectAgents, userAgents]) await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(projectAgents, 'project-review.md'), 'Project review agent.\n');
    await fs.writeFile(path.join(userAgents, 'user-review.md'), 'User review agent.\n');

    const child = spawn(process.execPath, [executable, 'web', '--no-open'], {
      cwd: project,
      env: { ...process.env, HOME: user, USERPROFILE: user, KITIA_CONFIG_DIR: config },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = once(child, 'exit');
    const stdout = createInterface({ input: child.stdout });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    try {
      const firstLine = await Promise.race([
        once(stdout, 'line').then(([line]) => line),
        exited.then(([code]) => assert.fail(`Kitia exited early (${code}): ${stderr}`)),
      ]);
      const match = firstLine.match(/^Kitia web: (http:\/\/127\.0\.0\.1:\d+\/#session=[\w-]+)$/);
      assert.ok(match, firstLine);
      const url = new URL(match[1]);
      const token = url.hash.slice('#session='.length);
      const origin = url.origin;
      const authorization = `Bearer ${token}`;
      const api = `${origin}/api/inventory`;
      const root = await request(origin);
      assert.equal(root.status, 200);
      assert.doesNotMatch(root.body, new RegExp(token));
      assert.match(root.headers['content-security-policy'], /frame-ancestors 'none'/);
      const asset = root.body.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1];
      assert.ok(asset, 'the HTML references its bundled client');
      assert.equal((await request(`${origin}${asset}`)).status, 200);

      assert.equal((await request(api)).status, 401);
      assert.equal((await request(api, { authorization: `Bearer ${'x'.repeat(token.length)}` })).status, 401);
      assert.equal((await request(api, { authorization, host: 'other.invalid' })).status, 403);
      const foreign = await request(api, { authorization, origin: 'https://other.invalid' });
      assert.equal(foreign.status, 403);
      assert.equal(foreign.headers['access-control-allow-origin'], undefined);
      assert.equal((await request(api, { authorization, 'sec-fetch-site': 'cross-site' })).status, 403);
      assert.equal((await request(api, { authorization, origin }, 'POST')).status, 405);

      const accepted = await request(api, { authorization, origin, 'sec-fetch-site': 'same-origin' });
      assert.equal(accepted.status, 200);
      assert.equal(accepted.headers['cache-control'], 'no-store');
      const { targets, inventory } = JSON.parse(accepted.body);
      assert.deepEqual(targets, { project: await fs.realpath(project), user: await fs.realpath(user) });
      assert.deepEqual(
        inventory.resources.map(({ id, scope, status }) => [id, scope, status]),
        [
          ['project-review', 'project', 'unmanaged'],
          ['user-review', 'user', 'unmanaged'],
        ],
      );
      assert.deepEqual(inventory.errors, []);
      await fs.access(config).then(
        () => assert.fail('a read created the config directory'),
        (error) => assert.equal(error.code, 'ENOENT'),
      );

      if (process.platform !== 'win32') {
        child.kill('SIGINT');
        assert.deepEqual(await exited, [0, null]);
        await assert.rejects(request(origin), { code: 'ECONNREFUSED' });
      }
    } finally {
      stdout.close();
      child.kill();
      await exited;
      await fs.rm(temporary, { recursive: true, force: true });
    }
  },
);
